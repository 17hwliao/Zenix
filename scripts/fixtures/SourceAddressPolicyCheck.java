package com.zenix.musicplayer;
import java.net.InetAddress;
public final class SourceAddressPolicyCheck {
    public static void main(String[] args)throws Exception {
        for(String address:new String[]{"127.0.0.1","10.0.0.1","192.168.1.1","100.64.0.1","169.254.169.254","198.18.0.1","203.0.113.1","::1","fc00::1","fe80::1","64:ff9b::a00:1","2002:a00:1::1","2001:db8::1","2001:0000::1"})
            if(!SourceAddressPolicy.blocked(InetAddress.getByName(address)))throw new AssertionError("Allowed blocked address: "+address);
        for(String address:new String[]{"8.8.8.8","1.1.1.1","2606:4700:4700::1111","2001:4860:4860::8888"})
            if(SourceAddressPolicy.blocked(InetAddress.getByName(address)))throw new AssertionError("Blocked public address: "+address);
        try {
            java.util.List<InetAddress> publicAnswer=java.util.List.of(InetAddress.getByName("8.8.8.8")),fake=java.util.List.of(InetAddress.getByName("198.18.0.26"));
            if(SourceDnsPlan.resolve(publicAnswer,()->{throw new AssertionError("ordinary DNS must not query another network");})!=publicAnswer)throw new AssertionError("ordinary DNS changed");
            if(SourceDnsPlan.resolve(fake,()->publicAnswer)!=publicAnswer)throw new AssertionError("real answer is not the exact pinned result");
            for(String address:new String[]{"127.0.0.1","192.168.1.1","198.18.0.1","::1"}){
                try{SourceDnsPlan.resolve(fake,()->java.util.List.of(InetAddress.getByName(address)));throw new AssertionError("unsafe fallback allowed");}catch(java.net.UnknownHostException expected){}
            }
            for(java.util.List<InetAddress> initial:java.util.List.of(java.util.List.<InetAddress>of(),java.util.List.of(InetAddress.getByName("127.0.0.1")),java.util.List.of(InetAddress.getByName("198.18.0.1"),InetAddress.getByName("8.8.8.8")))){
                try{SourceDnsPlan.resolve(initial,()->{throw new AssertionError("non-Fake-IP-only failures must not fall back");});throw new AssertionError("invalid initial address allowed");}catch(java.net.UnknownHostException expected){}
            }
        }catch(java.net.UnknownHostException failure){throw new AssertionError(failure);}
        System.out.println("Native address boundary: 18 cases passed");
    }
}
