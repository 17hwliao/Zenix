package android.net;
public class ConnectivityManager {
    public static boolean connected=true,metered=false;
    public Network getActiveNetwork(){return connected?new Network():null;}
    public NetworkCapabilities getNetworkCapabilities(Network network){return network==null?null:new NetworkCapabilities();}
    public boolean isActiveNetworkMetered(){return metered;}
}
