package android.content;
import java.io.File;
public class Context {
    private final File folder;
    public Context(File folder){this.folder=folder;}
    public Context getApplicationContext(){return this;}
    public File getFilesDir(){return folder;}
    public File getCacheDir(){return new File(folder,"cache");}
}
