import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int]
u.GetWindowTextLengthW.argtypes=[w.HWND]
Ps=[]
pid = None

def windows():
    out=[]
    @ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
    def cb(h, l):
        n=u.GetWindowTextLengthW(h)
        buf=ctypes.create_unicode_buffer(n+1)
        u.GetWindowTextW(h,buf,n+1)
        r=w.RECT(); u.GetWindowRect(h,ctypes.byref(r))
        out.append((h,buf.value,bool(u.IsWindowVisible(h)),bool(u.IsIconic(h)),r.right-r.left,r.bottom-r.top))
        return True
    u.EnumWindows(cb,0)
    return out

import subprocess,re
task=subprocess.run(['tasklist','/FI','IMAGENAME eq electron.exe','/FO','CSV'],capture_output=True).stdout.decode('gbk','replace')
pids=set(int(m) for m in re.findall(r'"electron\.exe","(\d+)"',task))
allw=[x for x in windows() if True]
def win_pid(h):
    p=w.DWORD(); u.GetWindowThreadProcessId(h,ctypes.byref(p)); return p.value
mine=[x for x in allw if win_pid(x[0]) in pids]
for x in mine:
    if x[4]>80 and x[5]>80:
        print('BEFORE', x)
main=max([x for x in mine if x[4]>600], key=lambda x:x[4], default=None)
if main:
    u.ShowWindow(main[0], 6)  # SW_MINIMIZE
    print('minimized', main[1], main[4], 'x', main[5])
for x in mine:
    if x[4]>80 and x[5]>80:
        print('AFTER', x)
