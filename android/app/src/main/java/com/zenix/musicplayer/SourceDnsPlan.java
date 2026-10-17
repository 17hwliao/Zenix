package com.zenix.musicplayer;

import java.net.*;
import java.util.*;

/** Fake-IP is never a connectable source address. Fallback must return real public IPs. */
final class SourceDnsPlan {
    interface Lookup { List<InetAddress> get() throws UnknownHostException; }
    static List<InetAddress> publicOnly(List<InetAddress> addresses) throws UnknownHostException {
        if(addresses.isEmpty())throw new UnknownHostException("资源服务器没有地址");
        for(InetAddress address:addresses)if(SourceAddressPolicy.blocked(address))throw new UnknownHostException("音乐源不能访问内网、本机或保留地址");
        return addresses;
    }
    static List<InetAddress> resolve(List<InetAddress> system,Lookup underlying) throws UnknownHostException {
        boolean fakeOnly=!system.isEmpty();
        for(InetAddress address:system){byte[] b=address.getAddress();fakeOnly&=b.length==4&&(b[0]&255)==198&&((b[1]&255)==18||(b[1]&255)==19);}
        return fakeOnly?publicOnly(underlying.get()):publicOnly(system);
    }
}
