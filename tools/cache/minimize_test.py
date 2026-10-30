import ctypes, ctypes.wintypes as w, subprocess, re, time
u = ctypes.windll.user32
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
u.GetWindowTextLengthW.argtypes=[w.HWND]

task=subprocess.run(['tasklist','/FI','IMAGENAME eq electron.exe','/FO','CSV'],capture_output=True).stdout.decode('gbk','replace')
pids=set(int(m) for m in re.findall(r'"electron\.exe","(\d+)"',task))

def windows():
    out=[]
    @ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
    def cb(h, l):
        n=u.GetWindowTextLengthW(h)
        buf=ctypes.create_unicode_buffer(n+1)
        u.GetWindowTextW(h,buf,n+1)
        r=w.RECT(); u.GetWindowRect(h,ctypes.byref(r))
        p=w.DWORD(); u.GetWindowThreadProcessId(h,ctypes.byref(p))
        out.append((h,buf.value,bool(u.IsWindowVisible(h)),bool(u.IsIconic(h)),r.right-r.left,r.bottom-r.top,p.value))
        return True
    u.EnumWindows(cb,0)
    return out

mine=[x for x in windows() if x[6] in pids and x[4]>200 and x[5]>120]
for x in mine: print('BEFORE', x)
main=[x for x in mine if x[1]=='PoE2 Upgrade Checker'][0]
panel=[x for x in mine if x[0]!=main[0] and x[1]=='poe2-upgrade-checker'][0]
u.ShowWindow(main[0], 6)  # SW_MINIMIZE
time.sleep(1.2)
print('main iconic:', bool(u.IsIconic(main[0])), 'visible:', bool(u.IsWindowVisible(main[0])))
print('panel iconic:', bool(u.IsIconic(panel[0])), 'visible:', bool(u.IsWindowVisible(panel[0])), 'size:', panel[4], panel[5])
print('panel foreground?', u.GetForegroundWindow()==panel[0])
u.ShowWindow(main[0], 9)  # SW_RESTORE
time.sleep(0.8)
print('restored main iconic:', bool(u.IsIconic(main[0])))
