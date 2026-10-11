using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text;

class SuperFastTrace {
    // --- Win32 API Definitions ---
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int c, ref PROCESS_BASIC_INFORMATION pbi, int sz, out int r);
    [DllImport("kernel32.dll")]
    static extern IntPtr OpenProcess(int access, bool inh, int pid);
    [DllImport("kernel32.dll")]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr baseAddr, byte[] buf, int sz, out IntPtr read);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION {
        public IntPtr ExitStatus; public IntPtr PebBaseAddress;
        public IntPtr AffinityMask; public IntPtr BasePriority;
        public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING {
        public ushort Length; public ushort MaximumLength; public IntPtr Buffer;
    }

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_READ = 0x0010;

    static int Main() {
        int pid = Process.GetCurrentProcess().Id;
        Tuple<int,string> ret=null;
        for (int i = 0; i < 3; i++) {
            ret = PrintProcessDetail(pid);
            pid=ret.Item1;
            if (pid <= 0) break;
        }
        if (IsNsFlagSet(ret.Item2.Split(' ')))
            return 1;
        return 0;
    }

    static Tuple<int,string> PrintProcessDetail(int pid) {
        IntPtr hProc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        try {
            var pbi = new PROCESS_BASIC_INFORMATION();
            int tmp;
            if (NtQueryInformationProcess(hProc, 0, ref pbi, Marshal.SizeOf(pbi), out tmp) != 0)
                return Tuple.Create(-1,"");
            IntPtr pebAddr = pbi.PebBaseAddress;
            IntPtr ppPtr = ReadPointer(hProc, pebAddr + 0x20);
            // CommandLine (UNICODE_STRING, offset 0x70 in x64)
            // UNICODE_STRING has the structure of { Length, MaxLength, BufferPtr }
            var cmdXml = ReadUnicodeString(hProc, ppPtr + 0x70);
            return Tuple.Create(pbi.InheritedFromUniqueProcessId.ToInt32(),cmdXml);
        }
        finally { CloseHandle(hProc); }
    }

    static IntPtr ReadPointer(IntPtr hProc, IntPtr addr) {
        byte[] buf = new byte[IntPtr.Size];
        IntPtr tmp;
        ReadProcessMemory(hProc, addr, buf, buf.Length, out tmp);
        return (IntPtr.Size == 8) ? (IntPtr)BitConverter.ToInt64(buf, 0) : (IntPtr)BitConverter.ToInt32(buf, 0);
    }

    static string ReadUnicodeString(IntPtr hProc, IntPtr addr) {
        byte[] structBuf = new byte[Marshal.SizeOf(typeof(UNICODE_STRING))];
        IntPtr tmp;
        ReadProcessMemory(hProc, addr, structBuf, structBuf.Length, out tmp);
        ushort len = BitConverter.ToUInt16(structBuf, 0);
        IntPtr bufferPtr = (IntPtr.Size == 8) ? (IntPtr)BitConverter.ToInt64(structBuf, 8) : (IntPtr)BitConverter.ToInt32(structBuf, 4);
        byte[] strBuf = new byte[len];
        ReadProcessMemory(hProc, bufferPtr, strBuf, len, out tmp);
        return Encoding.Unicode.GetString(strBuf);
    }

    public static bool IsNsFlagSet(string[] args)
    {
        if (args == null || args.Length == 0) return false;
        // (well-known) list of ssh options with arguments
        string flagsWithArgs = "bcDEeFIiJLlmOopQRSwW";
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg == "--") break;
            if (arg.Length < 2 || arg[0] != '-') continue;
            // parse other options
            for (int j = 1; j < arg.Length; j++)
            {
                char c = arg[j];
                if (c == 'N' || c == 's') // two options that we want to check
                {
                    return true;
                }
                if (flagsWithArgs.IndexOf(c) != -1)
                {
                    // e.g. "-p22"
                    if (j < arg.Length - 1)
                    {
                        break; 
                    }
                    else
                    {
                        // e.g. "-p 22"
                        i++;
                        break;
                    }
                }
            }
        }
        return false;
    }
}