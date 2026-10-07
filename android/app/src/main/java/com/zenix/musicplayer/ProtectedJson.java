package com.zenix.musicplayer;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-owned key never leaves Android Keystore. No plaintext fallback on failure. */
final class ProtectedJson {
    private static final String ALIAS="zenix.private-config.v1",FORMAT="zenix.keystore.v1";
    private static final byte[] AAD=FORMAT.getBytes(StandardCharsets.UTF_8);
    private static synchronized SecretKey key(boolean create)throws Exception {
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if(keys.containsAlias(ALIAS))return (SecretKey)keys.getKey(ALIAS,null);
        if(!create)throw new java.io.IOException("配置密钥不可用，已保留原文件");
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    static String encode(String plain)throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(AAD);
        return Json.obj("protection",FORMAT,"iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP),"ciphertext",Base64.encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP)).toString();
    }
    static JSONObject decode(JSONObject envelope)throws Exception {
        if(!FORMAT.equals(envelope.optString("protection")))throw new java.io.IOException("加密配置格式不受支持");
        byte[] iv=Base64.decode(envelope.getString("iv"),Base64.NO_WRAP);if(iv.length!=12)throw new java.io.IOException("加密配置 IV 无效");
        byte[] encrypted=Base64.decode(envelope.getString("ciphertext"),Base64.NO_WRAP);if(encrypted.length<16)throw new java.io.IOException("加密配置内容无效");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,iv));cipher.updateAAD(AAD);
        return new JSONObject(new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8));
    }
}
