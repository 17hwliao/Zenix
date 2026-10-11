package android.util;
import java.io.*;
public final class AtomicFile {
    private final File target;
    public AtomicFile(File target){this.target=target;}
    public FileInputStream openRead()throws IOException{return new FileInputStream(target);}
    public FileOutputStream startWrite()throws IOException{return new FileOutputStream(target);}
    public void finishWrite(FileOutputStream stream){try{stream.close();}catch(IOException e){throw new UncheckedIOException(e);}}
    public void failWrite(FileOutputStream stream){try{stream.close();}catch(IOException ignored){}}
}
