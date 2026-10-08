package android.util;
import java.io.*;
public final class AtomicFile {
    private final File target;
    public AtomicFile(File target){this.target=target;}
    public FileOutputStream startWrite()throws IOException{return new FileOutputStream(target);}
    public void finishWrite(FileOutputStream stream)throws IOException{stream.close();}
    public void failWrite(FileOutputStream stream)throws IOException{stream.close();}
}
