package com.zenix.musicplayer;
import org.json.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
final class SourceShareCheck {
    public static void main(String[] args)throws Exception {
        JSONObject fixture=new JSONObject(Files.readString(Path.of(args[0]),StandardCharsets.UTF_8));
        JSONObject result=SourceShare.bundle(fixture.getJSONArray("records"),source->fixture.getJSONObject("packs").getJSONObject(source.getString("id")));
        if(result.getJSONArray("sources").length()!=2)throw new AssertionError("All enabled/disabled sources must be included");
        String text=result.toString();if(text.contains("MUST_NOT_SHARE"))throw new AssertionError("Private settings leaked");
        try{SourceShare.bundle(new JSONArray(),source->null);throw new AssertionError("Empty share accepted");}catch(AssertionError e){throw e;}catch(Exception expected){}
        try{SourceShare.bundle(Json.array(fixture.getJSONArray("records").getJSONObject(0)),source->Json.obj("script","x".repeat(524289)));throw new AssertionError("Oversized source accepted");}catch(AssertionError e){throw e;}catch(Exception expected){}
        Files.writeString(Path.of(args[1]),text,StandardCharsets.UTF_8);System.out.println("SOURCE_SHARE_CONTRACT_PASS");
    }
}
