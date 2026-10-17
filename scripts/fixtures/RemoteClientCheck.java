package com.zenix.musicplayer;
import org.json.*;
public final class RemoteClientCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        for(String address:new String[]{"127.0.0.1:1234","169.254.1.2:1234","8.8.8.8:80","localhost:80","10.0.0.1:0","10.0.0.1:65536","010.0.0.1:80","http://192.168.1.2:80/path","https://192.168.1.2:80","192.168.1.2:80?x=1"}){try{RemoteClient.address(address);throw new AssertionError("unsafe address accepted: "+address);}catch(java.io.IOException expected){}}
        check(RemoteClient.address("http://192.168.1.2:12345").equals("http://192.168.1.2:12345"),"explicit private literal accepted");
        RemoteClient client=new RemoteClient();
        JSONObject waiting=client.invoke(Json.obj("operation","connect","address",args[0],"code",args[1]));check(waiting.optString("phase").equals("waiting")&&!waiting.has("token"),"native token never exposed to UI");
        JSONObject state=null;for(int i=0;i<30;i++){state=client.invoke(Json.obj("operation","status"));if(state.optString("phase").equals("connected"))break;Thread.sleep(20);}
        check(state!=null&&state.optString("phase").equals("connected"),"host approval observed");check(state.optString("title").equals("Remote Fixture")&&!state.has("url")&&!state.has("token"),"only public metadata returned");
        client.invoke(Json.obj("operation","play-pause"));client.invoke(Json.obj("operation","next"));client.invoke(Json.obj("operation","previous"));client.invoke(Json.obj("operation","seek","seconds",42));
        try{client.invoke(Json.obj("operation","volume","volume",2));throw new AssertionError("invalid volume");}catch(java.io.IOException expected){}
        try{client.invoke(Json.obj("operation","volume","volume",.4));throw new AssertionError("revoked session still accepted");}catch(java.io.IOException expected){}
        check(client.invoke(Json.obj("operation","disconnect")).optString("phase").equals("idle"),"disconnect clears session");client.close();
        RemoteClient redirected=new RemoteClient();try{redirected.invoke(Json.obj("operation","connect","address",args[2],"code","123456"));throw new AssertionError("redirect was followed");}catch(java.io.IOException expected){}finally{redirected.close();}
        System.out.println("REMOTE_CLIENT_CONTRACT_PASS");
    }
}
