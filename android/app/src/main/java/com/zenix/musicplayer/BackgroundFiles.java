package com.zenix.musicplayer;

import java.io.*;
import java.util.*;
import org.json.*;

/** A restore journal owns both background files until its recovery/undo ends. */
final class BackgroundFiles {
    static void prune(File directory,File current,JSONObject journal)throws IOException {
        Set<String> retained=new HashSet<>();
        if(current!=null)retained.add(current.getCanonicalPath());
        if(journal!=null)for(String phase:List.of("before","after")){
            JSONObject state=journal.optJSONObject(phase),appearance=state==null?null:state.optJSONObject("appearance"),background=appearance==null?null:appearance.optJSONObject("background");
            if(background!=null&&!background.optString("url").isEmpty())retained.add(new File(background.optString("url")).getCanonicalPath());
        }
        File[] files=directory.listFiles();if(files==null)return;
        for(File file:files)if(file.isFile()&&file.getName().startsWith("backdrop-")&&!retained.contains(file.getCanonicalPath()))file.delete();
    }
}
