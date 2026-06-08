import sys
import os
import json
import threading
from PySide6.QtWidgets import (QApplication, QMainWindow, QPushButton, QVBoxLayout, QHBoxLayout,
                               QWidget, QLabel, QCheckBox, QFileDialog, QSystemTrayIcon, QMenu, QTableWidget, QTableWidgetItem, QHeaderView)
from PySide6.QtGui import QIcon, QAction
from PySide6.QtCore import Qt
import reminder
import ocr_engine
import socket

class TimetableApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("智能课表助手 - 可视化编辑器")
        self.resize(850, 500) 
        
        self.time_slots = [
            "08:00", "08:50", "10:05", "10:55", "11:40", 
            "14:30", "15:20", "16:15", "17:05"
        ]
        self.days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        self.day_headers = ["周一", "周二", "周三", "周四", "周五"]
        
        main_layout = QVBoxLayout()
        
        self.info_label = QLabel("欢迎！双击课表单元格可直接修改内容，改完记得点击保存。")
        self.info_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        main_layout.addWidget(self.info_label)
        
        self.table = QTableWidget(9, 5) # 9行5列
        self.table.setHorizontalHeaderLabels(self.day_headers)
        self.table.setVerticalHeaderLabels([f"第{i+1}节\n({t})" for i, t in enumerate(self.time_slots)])
        
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        main_layout.addWidget(self.table)
        
        btn_layout = QHBoxLayout()
        
        self.btn_upload = QPushButton("📸 上传课表图片")
        self.btn_upload.clicked.connect(self.upload_image)
        btn_layout.addWidget(self.btn_upload)
        
        self.btn_save = QPushButton("💾 保存当前修改")
        self.btn_save.setStyleSheet("background-color: #2da44e; color: white; font-weight: bold;")
        self.btn_save.clicked.connect(self.save_table_to_json)
        btn_layout.addWidget(self.btn_save)
        
        self.cb_autostart = QCheckBox("开机自启动")
        self.cb_autostart.stateChanged.connect(self.toggle_autostart)
        btn_layout.addWidget(self.cb_autostart)
        
        main_layout.addLayout(btn_layout)
        
        container = QWidget()
        container.setLayout(main_layout)
        self.setCentralWidget(container)
        
        self.load_json_to_table()
        
        self.setup_tray()
        self.bg_thread = threading.Thread(target=reminder.run_scheduler, daemon=True)
        self.bg_thread.start()

    def load_json_to_table(self):
        """将本地的 timetable.json 转换为表格里的文字"""
        self.table.clearContents() 
        timetable = reminder.load_timetable()
        
        for day_idx, day_name in enumerate(self.days):
            classes = timetable.get(day_name, [])
            for cls in classes:
                time_str = cls.get("time", "")
                if time_str in self.time_slots:
                    row_idx = self.time_slots.index(time_str)
                    
                    display_text = f"{cls['course']}\n{cls['room']}"
                    item = QTableWidgetItem(display_text)
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    self.table.setItem(row_idx, day_idx, item)

    def save_table_to_json(self):
        """将界面表格里修改后的内容写回 timetable.json"""
        timetable_data = {day: [] for day in self.days}
        
        for col_idx, day_name in enumerate(self.days):
            for row_idx, time_str in enumerate(self.time_slots):
                item = self.table.item(row_idx, col_idx)
                if item and item.text().strip():
                    lines = [line.strip() for line in item.text().split("\n") if line.strip()]
                    course_name = lines[0] if len(lines) > 0 else "空课程"
                    classroom = lines[1] if len(lines) > 1 else "无固定教室"
                    
                    timetable_data[day_name].append({
                        "time": time_str,
                        "course": course_name,
                        "room": classroom
                    })
                    
        with open('timetable.json', 'w', encoding='utf-8') as f:
            json.dump(timetable_data, f, indent=4, ensure_ascii=False)
            
        self.info_label.setText("💾 本地修改已成功保存，后台提醒服务已刷新！")
        reminder.setup_daily_jobs() 

    def upload_image(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "选择课表图片", "", "Images (*.png *.jpg *.jpeg)")
        if file_path:
            self.info_label.setText("正在调用 Umi-OCR 解析...")
            QApplication.processEvents()
            
            success, msg = ocr_engine.parse_timetable_with_umi(file_path)
            self.info_label.setText(msg)
            
            if success:
                self.load_json_to_table() 

    def setup_tray(self):
        self.tray_icon = QSystemTrayIcon(self)
        self.tray_icon.setIcon(self.style().standardIcon(self.style().StandardPixmap.SP_ComputerIcon))
        
        tray_menu = QMenu()
        show_action = QAction("打开主界面", self)
        quit_action = QAction("彻底退出", self)
        
        show_action.triggered.connect(self.showNormal)
        quit_action.triggered.connect(QApplication.instance().quit)
        
        tray_menu.addAction(show_action)
        tray_menu.addAction(quit_action)
        self.tray_icon.setContextMenu(tray_menu)
        self.tray_icon.show()

    def closeEvent(self, event):
        if self.tray_icon.isVisible():
            self.hide()
            self.tray_icon.showMessage("课表助手", "已最小化到系统托盘，继续在后台运行", QSystemTrayIcon.Information, 2000)
            event.ignore()

    def toggle_autostart(self, state):
        if sys.platform != "win32":
            return
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        app_name = "TimetableAssistant"
        app_path = os.path.abspath(sys.argv[0])
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE)
            if state:
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, f'"{sys.executable}" "{app_path}"')
            else:
                try: winreg.DeleteValue(key, app_name)
                except FileNotFoundError: pass
            winreg.CloseKey(key)
        except Exception as e:
            self.info_label.setText(f"设置自启失败: {e}")
            
def check_single_instance():
    global _instance_lock
    _instance_lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _instance_lock.bind(('127.0.0.1', 54321))
    except socket.error:
        try:
            import win32gui
            import win32con
            win32gui.MessageBox(
                0, 
                " 课表助手已在后台运行，请勿重复开启！\n\n 在右下角的小托盘栏里。", 
                "提示", 
                win32con.MB_OK | win32con.MB_ICONINFORMATION | win32con.MB_SYSTEMMODAL
            )
        except Exception:
            pass 
        
        sys.exit(0) 


if __name__ == "__main__":
    check_single_instance()

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    window = TimetableApp()
    window.show()
    sys.exit(app.exec())