package com.zenix.musicplayer;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;

/** Edge wire-token compatibility port from node-edge-tts 1.2.12 (MIT, SchneeHertz).
 * Attribution and full license: licenses/node-edge-tts/LICENSE.
 * This is not used for app updates, encryption, user credentials or authentication decisions.
 */
final class EdgeVoiceToken {
    static final String CLIENT = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private static final int[][] COEFFICIENTS = {
        {0xE82E91B1,0xB32700D0},{0x44DE24C6,0x88DFF51D},{0x3BEB65BC,0x29514038},
        {0xC89C5933,0xB328CBDF},{0x8D1EC211,0xD405B4D5},{0x314EF5D5,0x26E55F3C},
        {0xE92491B1,0x607801C6},{0xF0A5B9D5,0x82B2C1FB},{0x06064CF3,0xFA51A3DA},
        {0xDA79FA60,0x207CC464},{0xBED20560,0x3C3C74F3},{0x89F9C9F8,0xD2D14B61},
        {0x35FA38C6,0xBB04A2C1},{0xCB49E3C6,0xC5626167}
    };
    static String generate(long unixMillis) throws Exception {
        long seconds = unixMillis / 1000 + 11644473600L;
        byte[] data = ((seconds - seconds % 300) * 10000000L + CLIENT).getBytes(StandardCharsets.US_ASCII);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update("Copyright (C) Microsoft Corporation. All rights reserved.".getBytes(StandardCharsets.US_ASCII));
        byte[] sha = digest.digest(data);
        ByteBuffer keys = ByteBuffer.wrap(sha).order(ByteOrder.LITTLE_ENDIAN);
        int keyA = keys.getInt() | 1, keyB = keys.getInt() | 1;
        int[] factors = {keyA * 0x82893933, keyB * 0x82893933};
        ArrayList<Integer> terms = new ArrayList<>(), offsets = new ArrayList<>();
        for (int i=0;i<COEFFICIENTS.length;i++) {terms.add(COEFFICIENTS[i][0]*factors[i%2]);offsets.add(COEFFICIENTS[i][1]);}
        byte[] padded = new byte[((data.length + 8) / 8) * 8];
        System.arraycopy(data,0,padded,1,data.length);
        ByteBuffer words = ByteBuffer.wrap(padded).order(ByteOrder.LITTLE_ENDIAN);
        for(int i=0;words.hasRemaining();i++) {
            int word=words.getInt(),term=word*(i%2==0?keyA:keyB),offset=Integer.rotateLeft(word,16)*(i%2==0?0xEF0569FB:0xC31713DB);
            if(i==0){term+=0xF2F90B1A*factors[0];offset+=0x0B1A0000;}
            terms.add(term);offsets.add(offset);
        }
        int swapAcc=0,swapLast=0,state=0,acc=0;
        for(int i=0;i<terms.size();i+=2){
            int x=terms.get(i),y=terms.get(i+1);
            int q=Integer.rotateLeft(offsets.get(i)+x,16)*0x76F50F34;
            swapAcc+=Integer.rotateLeft(q,16)*0xC3EFEA97+q;
            q=Integer.rotateLeft(offsets.get(i+1)+y,16)*0x1881CE3C;
            swapLast=Integer.rotateLeft(q,16)*0x35BD1EC9+q;swapAcc+=swapLast;
            state=state*keyA+x;
            for(int k:new int[]{0xCF98B111,0x87085B9F,0x12CEB96D,0x257E1D83})state=Integer.rotateLeft(state,16)*k;
            acc+=state;
            int t=Integer.rotateLeft(state*keyB+y,16)*0xA27416F5;
            t=Integer.rotateLeft(t,16)*0xD38396FF;
            state=Integer.rotateLeft(Integer.rotateLeft(t,16)*0x7C932B89,16)*0xBFA49F69;
            acc+=state;
        }
        byte[] cs64=ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(swapLast^state).putInt(swapAcc^acc).array();
        return hex(cs64)+"-"+hex(sha);
    }
    private static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte item:bytes)value.append(String.format(java.util.Locale.ROOT,"%02X",item&255));return value.toString();}
}
