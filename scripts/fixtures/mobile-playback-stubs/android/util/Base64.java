package android.util;
public final class Base64 {
    public static final int DEFAULT=0,NO_PADDING=1,NO_WRAP=2,URL_SAFE=8;
    public static byte[] decode(String text,int flags){return (flags&URL_SAFE)!=0?java.util.Base64.getUrlDecoder().decode(text):java.util.Base64.getDecoder().decode(text);}
    public static String encodeToString(byte[] bytes,int flags){return java.util.Base64.getEncoder().encodeToString(bytes);}
}
