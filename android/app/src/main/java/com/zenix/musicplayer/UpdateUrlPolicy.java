package com.zenix.musicplayer;

import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Built-in update endpoints, independent of untrusted music-source permissions. */
final class UpdateUrlPolicy {
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
        "raw.githubusercontent.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"));
    static void validate(String address) throws IOException {
        try {
            URI uri = new URI(address);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null || uri.getHost() == null
                || !HOSTS.contains(uri.getHost().toLowerCase(Locale.ROOT))) {
                throw new IOException("更新地址必须使用允许的 GitHub HTTPS 服务器");
            }
        } catch (java.net.URISyntaxException error) { throw new IOException("更新地址格式无效", error); }
    }
}
