package com.zenix.musicplayer;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import okhttp3.*;

/** Public playlist metadata only; never uses update trust or source credentials. */
final class PlaylistLinksHttp {
    private static final Set<String> HOSTS=Set.of("y.qq.com","i.y.qq.com","i2.y.qq.com","c.y.qq.com","u.y.qq.com","c6.y.qq.com","music.163.com","y.music.163.com","163cn.tv","www.kuwo.cn","kuwo.cn","h5app.kuwo.cn","nplserver.kuwo.cn");
    static URI address(String raw)throws Exception {
        if(raw.length()>8192)throw new Exception("歌单地址过长");
        URI uri=new URI(raw);
        if(!"https".equals(uri.getScheme())||uri.getHost()==null||!HOSTS.contains(uri.getHost())||uri.getPort()!=-1&&uri.getPort()!=443||uri.getRawUserInfo()!=null)throw new Exception("只能读取支持平台的 HTTPS 公开歌单");
        return uri;
    }
    static JSONObject request(JSONObject args)throws Exception {
        URI url=address(args.getString("url"));String method=args.optString("method","GET"),body=args.optString("body","");
        if(!Set.of("GET","POST").contains(method)||method.equals("POST")&&(!url.getHost().equals("u.y.qq.com")||!url.getPath().equals("/cgi-bin/musicu.fcg"))||body.getBytes(StandardCharsets.UTF_8).length>32768)throw new Exception("歌单请求无效");
        OkHttpClient client=SourceHttp.publicOnce(25000);long deadline=android.os.SystemClock.elapsedRealtime()+25000;
        for(int hop=0;hop<=5;hop++) {
            if(method.equals("POST")&&(!url.getHost().equals("u.y.qq.com")||!url.getPath().equals("/cgi-bin/musicu.fcg")))throw new Exception("歌单请求跳转到了不支持的接口");
            long remaining=deadline-android.os.SystemClock.elapsedRealtime();if(remaining<=0)throw new Exception("歌单读取超时");
            String host=url.getHost(),referer=host.endsWith("qq.com")?"https://y.qq.com/":host.contains("163")?"https://music.163.com/":"https://www.kuwo.cn/";
            Request.Builder builder=new Request.Builder().url(url.toString()).header("Referer",referer).header("User-Agent","Mozilla/5.0 Zenix").header("Accept-Encoding","identity");
            if(method.equals("POST"))builder.post(RequestBody.create(body.getBytes(StandardCharsets.UTF_8),MediaType.parse("application/json")));
            Call call=client.newCall(builder.build());call.timeout().timeout(remaining,TimeUnit.MILLISECONDS);
            try(Response response=call.execute()) {
                int status=response.code();
                if(Set.of(301,302,303,307,308).contains(status)) {
                    String location=response.header("Location");if(location==null||hop==5)throw new Exception("歌单重定向无效或次数过多");
                    url=address(url.resolve(location).toString());if(status==301||status==302||status==303){method="GET";body="";}continue;
                }
                ResponseBody data=response.body();if(data!=null&&data.contentLength()>SourceHttp.MAX_BYTES)throw new Exception("歌单响应过大");
                String text=data==null?"":new String(SourceHttp.bounded(data.byteStream(),SourceHttp.MAX_BYTES),StandardCharsets.UTF_8);
                return Json.obj("url",url.toString(),"status",status,"text",text);
            }
        }
        throw new Exception("歌单重定向过多");
    }
}
