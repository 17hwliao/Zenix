package com.zenix.musicplayer;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Separate Keystore identity and no-backup file. Ordinary music backups never receive this vault. */
final class AssistantModelCredentials implements AssistantModel.Vault {
    private static final String ALIAS = "zenix.assistant-model.v1", FORMAT = "zenix.assistant-keystore.v1";
    private final AtomicFile file;
    AssistantModelCredentials(Context context) { file = new AtomicFile(new File(context.getNoBackupFilesDir(), "assistant-model.private.json")); }
    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(ALIAS)) return (SecretKey) keys.getKey(ALIAS, null);
        if (!create) throw new IOException("模型密钥不可用");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    @Override public JSONObject read() throws Exception {
        if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return null;
        byte[] bytes;
        try (InputStream input = file.openRead()) { bytes = AssistantModel.readBounded(input, 64 * 1024, () -> {}); }
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!FORMAT.equals(envelope.optString("protection"))) throw new IOException("模型配置格式无效");
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        if (iv.length != 12) throw new IOException("模型配置加密参数无效");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
        cipher.updateAAD(FORMAT.getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    @Override public void write(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true));
        cipher.updateAAD(FORMAT.getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject().put("protection", FORMAT).put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("ciphertext", Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        FileOutputStream output = null;
        try { output = file.startWrite(); output.write(envelope.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
    }
}
