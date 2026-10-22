package android.content;
import java.io.File;
public class Context {
    public static final String CONNECTIVITY_SERVICE="connectivity";
    public Object getSystemService(String name){return new android.net.ConnectivityManager();}
    private final File folder;
    public Context(File folder){this.folder=folder;}
    public Context getApplicationContext(){return this;}
    public File getFilesDir(){return folder;}
    public File getCacheDir(){return new File(folder,"cache");}
}
