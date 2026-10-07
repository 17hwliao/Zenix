package com.zenix.musicplayer;
import java.net.InetAddress;
public final class SourceAddressPolicyCheck {
    public static void main(String[] args)throws Exception {
        for(String address:new String[]{"127.0.0.1","10.0.0.1","192.168.1.1","100.64.0.1","169.254.169.254","198.18.0.1","203.0.113.1","::1","fc00::1","fe80::1","64:ff9b::a00:1","2002:a00:1::1","2001:db8::1","2001:0000::1"})
            if(!SourceAddressPolicy.blocked(InetAddress.getByName(address)))throw new AssertionError("Allowed blocked address: "+address);
        for(String address:new String[]{"8.8.8.8","1.1.1.1","2606:4700:4700::1111","2001:4860:4860::8888"})
            if(SourceAddressPolicy.blocked(InetAddress.getByName(address)))throw new AssertionError("Blocked public address: "+address);
        System.out.println("Native address boundary: 18 cases passed");
    }
}
