package com.zenix.musicplayer;
import java.net.InetAddress;

/** Pure address policy shared by the connection boundary and JVM regression. */
final class SourceAddressPolicy {
    static boolean blocked(InetAddress address) {
        byte[] b=address.getAddress();int a=b[0]&255,c=b[1]&255,d=b[2]&255,e=b[3]&255;
        boolean specialV6=b.length==16&&((a&0xe0)!=0x20||a==0x20&&c==0x02||a==0x20&&c==0x01&&(d<2||d==0x0d&&e==0xb8)||a==0x3f&&c==0xff);
        boolean specialV4=b.length==4&&(a==0||a==100&&c>=64&&c<=127||a==192&&(c==0&&(d==0||d==2)||c==88&&d==99)||a==198&&(c==18||c==19||c==51&&d==100)||a==203&&c==0&&d==113||a>=224);
        return address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress()||specialV6||specialV4;
    }
}
