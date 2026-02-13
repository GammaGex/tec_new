import os
import sys
import shutil
import time
import zipfile
import subprocess
import winshell
from win32com.client import Dispatch
import traceback
from datetime import datetime
import ctypes
import json

# --- CONFIGURATION ---
APP_NAME = "GexBrowser"
EXE_NAME = "GexBrowser.exe"
ZIP_NAME = "GexBrowser_Setup.zip"
LOG_FILE = os.path.join(os.environ.get('TEMP', os.getcwd()), 'GexInstaller_Log.txt')

def show_error_popup(title, message):
    try:
        ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
    except:
        pass

def log(msg):
    timestamp = datetime.now().strftime("[%H:%M:%S]")
    formatted_msg = f"{timestamp} {msg}"
    print(formatted_msg)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(formatted_msg + "\n")
    except:
        pass

def get_base_path():
    """Returns the base path, handling temporary extraction by PyInstaller."""
    if getattr(sys, 'frozen', False):
        # Temporary folder where PyInstaller extracts files (--onefile)
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def get_current_dir():
    """Returns the directory where the executable (or script) is running."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def force_kill_process(process_name):
    log(f"Checking if {process_name} is open...")
    subprocess.call(f"taskkill /F /IM {process_name}", shell=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    time.sleep(1)

# --- INSTALLER MODE (END CLIENT) ---
def run_installer_mode():
    if os.path.exists(LOG_FILE):
        try: os.remove(LOG_FILE)
        except: pass

    log("="*60)
    log(f"INSTALLER STARTED - {APP_NAME}")
    log("="*60)
    
    try:
        user_home = os.path.expanduser('~')
        local_app_data = os.environ.get('LOCALAPPDATA', os.path.join(user_home, 'AppData', 'Local'))
        install_dir = os.path.join(local_app_data, 'Programs', APP_NAME)
        
        # Desktop location definition
        desktop_paths = set()
        try: desktop_paths.add(winshell.desktop())
        except: pass
        desktop_paths.add(os.path.join(user_home, 'Desktop'))
        
        try: target_desktop = winshell.desktop()
        except: target_desktop = os.path.join(user_home, 'Desktop')

        shortcut_path = os.path.join(target_desktop, f"{APP_NAME}.lnk")
        
        # IMPORTANT: Looks for ZIP inside the package extracted by PyInstaller
        zip_path = os.path.join(get_base_path(), ZIP_NAME)
        
        if not os.path.exists(zip_path):
            err_msg = f"Data file not found in package:\n{zip_path}"
            log(err_msg)
            show_error_popup("Resource Error", err_msg)
            sys.exit(1)

        # PHASE 1: Close old app
        force_kill_process(EXE_NAME)
        app_data_roaming = os.environ.get('APPDATA')
        saved_creds = None
        settings_dir_hint = None
        if app_data_roaming:
            for d in [os.path.join(app_data_roaming, 'GexBrowser'), os.path.join(app_data_roaming, 'gex-browser-enterprise')]:
                sp = os.path.join(d, 'settings.json')
                if os.path.exists(sp):
                    try:
                        with open(sp, 'r', encoding='utf-8') as f:
                            js = json.load(f)
                        c = js.get('savedCreds')
                        if c and isinstance(c, dict) and c.get('user') and c.get('passB64'):
                            saved_creds = {'user': c.get('user'), 'passB64': c.get('passB64')}
                            settings_dir_hint = d
                            break
                    except:
                        pass

        # Backup User Data
        temp_backup = os.path.join(os.environ.get('TEMP', user_home), 'GexDataBackup_Temp')
        if os.path.exists(temp_backup): shutil.rmtree(temp_backup, ignore_errors=True)

        possible_folders = ['userData', 'User Data']
        backup_source = None
        for folder in possible_folders:
            cp = os.path.join(install_dir, folder)
            if os.path.exists(cp):
                backup_source = cp
                break
        
        has_backup = False
        if backup_source:
            log(f"Backing up: {backup_source}")
            try:
                shutil.copytree(backup_source, temp_backup)
                has_backup = True
            except Exception as e:
                log(f"Backup failed: {e}")

        # Clean old installation
        if os.path.exists(install_dir):
            try: shutil.rmtree(install_dir)
            except Exception as e: log(f"Warning when cleaning folder: {e}")

        # PHASE 2: Extraction
        log(f"Extracting files to {install_dir}...")
        os.makedirs(install_dir, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(install_dir)

        # PHASE 3: Restore Backup
        if has_backup:
            log("Restoring previous session...")
            target_name = os.path.basename(backup_source)
            target_userdata = os.path.join(install_dir, target_name)
            if os.path.exists(target_userdata): shutil.rmtree(target_userdata, ignore_errors=True)
            try: shutil.move(temp_backup, target_userdata)
            except: pass

        # PHASE 4: LevelDB Update
        try:
            app_data_roaming = os.environ.get('APPDATA')
            if app_data_roaming:
                leveldb_target_path = os.path.join(app_data_roaming, 'gex-browser-enterprise', 'Partitions', 'gex', 'Local Storage', 'leveldb')
                leveldb_source_path = os.path.join(get_base_path(), 'levelbd')
                if os.path.exists(leveldb_source_path):
                    if os.path.exists(leveldb_target_path):
                        shutil.rmtree(leveldb_target_path, ignore_errors=True)
                    shutil.copytree(leveldb_source_path, leveldb_target_path)
                    log(f"LevelDB atualizado em: {leveldb_target_path}")
                else:
                    log("LevelDB Warning: Pasta levelbd não encontrada no instalador")
        except Exception as e:
            log(f"LevelDB Warning: {e}")
        if saved_creds and app_data_roaming:
            try:
                target_dir = settings_dir_hint or os.path.join(app_data_roaming, 'GexBrowser')
                os.makedirs(target_dir, exist_ok=True)
                target_settings = os.path.join(target_dir, 'settings.json')
                data = {}
                if os.path.exists(target_settings):
                    try:
                        with open(target_settings, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                    except:
                        data = {}
                data['savedCreds'] = saved_creds
                with open(target_settings, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                log(f"Warning restoring credentials: {e}")

        # PHASE 5: Shortcuts
        log("Configuring shortcuts...")
        target_exe = os.path.join(install_dir, EXE_NAME)
        shell = Dispatch('WScript.Shell')
        shortcut = shell.CreateShortCut(shortcut_path)
        shortcut.Targetpath = target_exe
        shortcut.WorkingDirectory = install_dir
        shortcut.IconLocation = target_exe
        shortcut.save()

        log("Installation completed successfully!")
        ctypes.windll.user32.MessageBoxW(0, "GexBrowser was updated successfully!", "Success", 0x40)
        sys.exit(0)
        
    except Exception as e:
        log(traceback.format_exc())
        show_error_popup("Fatal Error", f"An error occurred during installation:\n{str(e)}")
        sys.exit(1)

# --- BUILDER MODE (DEVELOPER) ---
def run_builder_mode():
    # Timestamp with Minutes to avoid Windows cache
    installer_base_name = f"{APP_NAME}_Installer"
    installer_exe_name = f"{installer_base_name}.exe"
    
    print(f"\n>>> STARTING BUILD: {installer_exe_name} <<<\n")
    
    project_dir = get_current_dir()
    dist_build_dir = os.path.join(project_dir, "dist_build") 
    
    # Cleanup
    if os.path.exists(dist_build_dir): shutil.rmtree(dist_build_dir)
    if os.path.exists(ZIP_NAME): os.remove(ZIP_NAME)
        
    print("1. Compiling Electron (electron-builder)...")
    subprocess.check_call(
        ["npx.cmd", "electron-builder", "--win", "--dir", f"--config.directories.output={dist_build_dir}"],
        cwd=project_dir
    )
    
    print("2. Creating ZIP package of compiled files...")
    unpacked_dir = os.path.join(dist_build_dir, "win-unpacked")
    
    # Standardize executable name inside ZIP
    for f in os.listdir(unpacked_dir):
        if f.endswith(".exe") and "uninstall" not in f.lower() and f.lower() != EXE_NAME.lower():
            os.rename(os.path.join(unpacked_dir, f), os.path.join(unpacked_dir, EXE_NAME))
    
    with zipfile.ZipFile(ZIP_NAME, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(unpacked_dir):
            for file in files:
                file_path = os.path.join(root, file)
                zipf.write(file_path, os.path.relpath(file_path, unpacked_dir))
                
    print(f"3. Packaging with PyInstaller ({installer_exe_name})...")
    # --clean clears PyInstaller cache
    # --noconsole can be used after testing, for now we keep console to see errors
    def add_data_arg(src, dest):
        return f'{src}{os.pathsep}{dest}'

    pyinst_cmd = [
        'pyinstaller',
        '--noconfirm',
        '--onefile',
        '--console',
        '--clean',
        '--name', installer_base_name,
        '--add-data', add_data_arg(ZIP_NAME, '.'),
        'setup.py'
    ]
    leveldb_dir = os.path.join(project_dir, 'levelbd')
    if os.path.exists(leveldb_dir):
        pyinst_cmd += ['--add-data', add_data_arg(leveldb_dir, 'levelbd')]
    subprocess.check_call(pyinst_cmd, cwd=project_dir)
        
    print("4. Organizing final files...")
    dist_dir = os.path.join(project_dir, "dist")
    generated_exe = os.path.join(dist_dir, installer_exe_name)
    final_exe = os.path.join(project_dir, installer_exe_name)

    if os.path.exists(generated_exe):
        if os.path.exists(final_exe): os.remove(final_exe)
        shutil.move(generated_exe, final_exe)
        print(f"\nSUCCESS: {installer_exe_name} generated in project root.")
    
    # Build folders cleanup
    for folder in [dist_dir, os.path.join(project_dir, "build"), dist_build_dir]:
        shutil.rmtree(folder, ignore_errors=True)
    if os.path.exists(ZIP_NAME): os.remove(ZIP_NAME)
    spec_file = os.path.join(project_dir, f"{installer_base_name}.spec")
    if os.path.exists(spec_file): os.remove(spec_file)

if __name__ == "__main__":
    if getattr(sys, 'frozen', False):
        run_installer_mode()
    else:
        run_builder_mode()
