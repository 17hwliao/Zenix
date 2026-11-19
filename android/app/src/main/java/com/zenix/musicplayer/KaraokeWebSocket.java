package com.zenix.musicplayer;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/** Bounded RFC6455 client for the encrypted Zenix K-song channel. */
final class KaraokeWebSocket implements Runnable {
    static final int MAX_FRAME = 144 * 1024;
    private static final int MAX_HANDSHAKE = 4096;
    private static final int OPEN_TIMEOUT_MS = 5_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final int CLOSE_TIMEOUT_MS = 600;
    private static final int TEXT = 1, CLOSE = 8, PING = 9, PONG = 10;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String ACCEPT_SUFFIX = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    interface Listener {
        void opened();
        void text(String value);
        void ended(IOException error);
    }

    private final Socket socket = new Socket(Proxy.NO_PROXY);
    private final InetSocketAddress target;
    private final String authority;
    private final Executor workers;
    private final Listener listener;
    // One reserved slot allows Close to follow all already queued messages.
    private final ArrayBlockingQueue<Frame> outgoing = new ArrayBlockingQueue<>(9);
    private final CountDownLatch closeSent = new CountDownLatch(1);
    private volatile boolean open;
    private boolean closing;

    KaraokeWebSocket(InetAddress address, int port, Executor workers, Listener listener) {
        target = new InetSocketAddress(address, port);
        authority = address.getHostAddress() + ":" + port;
        this.workers = workers;
        this.listener = listener;
    }

    synchronized boolean send(String value) {
        if (!open || closing || value.length() > MAX_FRAME || outgoing.remainingCapacity() < 2) return false;
        byte[] data = value.getBytes(StandardCharsets.UTF_8);
        return data.length <= MAX_FRAME && outgoing.offer(new Frame(TEXT, data));
    }

    synchronized void close() {
        if (!enqueueClose(closeCode(1000))) cancel();
    }

    void cancel() {
        try { socket.close(); } catch (IOException ignored) {}
    }

    private synchronized boolean enqueueClose(byte[] data) {
        if (!open) return false;
        if (closing) return true;
        closing = true;
        return outgoing.offer(new Frame(CLOSE, data));
    }

    @Override public void run() {
        IOException failure = null;
        try {
            socket.connect(target, OPEN_TIMEOUT_MS);
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(OPEN_TIMEOUT_MS);
            InputStream input = new BufferedInputStream(socket.getInputStream());
            OutputStream output = new BufferedOutputStream(socket.getOutputStream());
            upgrade(input, output, authority);
            socket.setSoTimeout(READ_TIMEOUT_MS);
            open = true;
            workers.execute(() -> writeLoop(output));
            listener.opened();
            readLoop(input);
        } catch (IOException e) {
            failure = e;
        } catch (RuntimeException e) {
            failure = new IOException("K 歌网络任务无法完成", e);
        } finally {
            open = false;
            cancel();
            outgoing.clear();
            listener.ended(failure);
        }
    }

    private void readLoop(InputStream input) throws IOException {
        MessageReader reader = new MessageReader(input);
        try {
            while (true) {
                Frame frame = reader.next();
                switch (frame.opcode) {
                    case TEXT:
                        listener.text(utf8(frame.data, 0));
                        break;
                    case PING:
                        synchronized (this) {
                            if (!closing && (outgoing.remainingCapacity() < 2 || !outgoing.offer(new Frame(PONG, frame.data)))) {
                                throw new ProtocolError(1002, "K 歌连接积压");
                            }
                        }
                        break;
                    case PONG:
                        break;
                    case CLOSE:
                        validateClose(frame.data);
                        finishClose(frame.data);
                        return;
                    default:
                        throw new ProtocolError(1002, "K 歌消息类型无效");
                }
            }
        } catch (ProtocolError e) {
            finishClose(closeCode(e.code));
            throw e;
        }
    }

    private void finishClose(byte[] data) {
        if (!enqueueClose(data)) return;
        try { closeSent.await(CLOSE_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private void writeLoop(OutputStream output) {
        try {
            while (!socket.isClosed()) {
                Frame frame = outgoing.poll(5, TimeUnit.SECONDS);
                if (frame == null) frame = new Frame(PING, new byte[0]);
                writeMasked(output, frame);
                if (frame.opcode == CLOSE) {
                    closeSent.countDown();
                    return;
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            cancel();
        } finally {
            closeSent.countDown();
        }
    }

    static void upgrade(InputStream input, OutputStream output, String authority) throws IOException {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        String nonce = Base64.getEncoder().encodeToString(bytes);
        String request = "GET /zenix/karaoke HTTP/1.1\r\nHost: " + authority
                + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13"
                + "\r\nSec-WebSocket-Key: " + nonce + "\r\n\r\n";
        output.write(request.getBytes(StandardCharsets.US_ASCII));
        output.flush();

        HeaderReader reader = new HeaderReader(input);
        if (!reader.line().matches("HTTP/1\\.1 101(?: .*)?")) throw new IOException("房主拒绝 K 歌连接");
        Map<String, String> headers = new HashMap<>();
        for (String line = reader.line(); !line.isEmpty(); line = reader.line()) {
            int separator = line.indexOf(':');
            if (separator <= 0 || !line.substring(0, separator).matches("[A-Za-z0-9-]+")) throw new IOException("K 歌连接响应无效");
            String name = line.substring(0, separator).toLowerCase(Locale.ROOT);
            if (headers.putIfAbsent(name, line.substring(separator + 1).trim()) != null) throw new IOException("K 歌连接响应字段重复");
        }
        if (!"websocket".equalsIgnoreCase(headers.get("upgrade"))
                || !hasUpgradeToken(headers.get("connection"))
                || !expectedAccept(nonce).equals(headers.get("sec-websocket-accept"))
                || headers.containsKey("sec-websocket-extensions")
                || headers.containsKey("sec-websocket-protocol")) {
            throw new IOException("房主未完成 K 歌握手");
        }
    }

    private static boolean hasUpgradeToken(String value) {
        return value != null && Arrays.stream(value.split(",")).anyMatch(token -> "upgrade".equalsIgnoreCase(token.trim()));
    }

    private static String expectedAccept(String nonce) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest((nonce + ACCEPT_SUFFIX).getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) { throw new IOException("当前环境不支持 K 歌握手", e); }
    }

    private static final class HeaderReader {
        private final InputStream input;
        private final long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(OPEN_TIMEOUT_MS);
        private int read;

        HeaderReader(InputStream input) { this.input = input; }

        String line() throws IOException {
            ByteArrayOutputStream output = new ByteArrayOutputStream(96);
            while (true) {
                int b = next();
                if (b == '\r') {
                    if (next() != '\n') throw new IOException("K 歌连接响应换行无效");
                    return new String(output.toByteArray(), StandardCharsets.US_ASCII);
                }
                if ((b < 0x20 && b != '\t') || b > 0x7e) throw new IOException("K 歌连接响应格式无效");
                output.write(b);
            }
        }

        private int next() throws IOException {
            if (System.nanoTime() >= deadline || ++read > MAX_HANDSHAKE) throw new IOException("K 歌连接响应过大或未及时返回");
            return getByte(input);
        }
    }

    static final class MessageReader {
        private final InputStream input;
        private byte[] fragmented;
        private int count;

        MessageReader(InputStream input) { this.input = input; }

        Frame next() throws IOException {
            while (true) {
                int header = getByte(input);
                int flags = getByte(input);
                int opcode = header & 15;
                boolean finalFrame = (header & 128) != 0;
                boolean control = opcode >= 8;
                if ((header & 112) != 0 || (flags & 128) != 0) throw new ProtocolError(1002, "K 歌消息标记无效");
                if (opcode == 2) throw new ProtocolError(1003, "K 歌仅接收文本消息");
                if ((control && (opcode > PONG || !finalFrame || (flags & 127) > 125))
                        || (!control && ((opcode != 0 && opcode != TEXT) || (opcode == 0) != (fragmented != null)))) {
                    throw new ProtocolError(1002, "K 歌消息分帧无效");
                }
                long length = flags & 127;
                if (length == 126) {
                    length = ((long) getByte(input) << 8) | getByte(input);
                    if (length < 126) throw new ProtocolError(1002, "K 歌消息长度编码无效");
                } else if (length == 127) {
                    length = getByte(input);
                    if (length > 127) throw new ProtocolError(1002, "K 歌消息长度编码无效");
                    for (int i = 1; i < 8; i++) length = (length << 8) | getByte(input);
                    if (length <= 65_535) throw new ProtocolError(1002, "K 歌消息长度编码无效");
                }
                // Check both the declared frame length and the remaining
                // message budget before allocating or reading any payload.
                int available = control ? 125 : MAX_FRAME - count;
                if (length > available) throw new ProtocolError(1009, "K 歌消息超过长度限制");
                int size = (int) length;
                if (control || (opcode == TEXT && finalFrame)) {
                    byte[] data = new byte[size];
                    readFully(input, data, 0, size);
                    return new Frame(opcode, data);
                }
                if (fragmented == null) fragmented = new byte[MAX_FRAME];
                readFully(input, fragmented, count, size);
                count += size;
                if (finalFrame) {
                    byte[] result = Arrays.copyOf(fragmented, count);
                    fragmented = null;
                    count = 0;
                    return new Frame(TEXT, result);
                }
            }
        }
    }

    private static void writeMasked(OutputStream output, Frame frame) throws IOException {
        output.write(128 | frame.opcode);
        int size = frame.data.length;
        if (size <= 125) output.write(128 | size);
        else if (size <= 65535) {
            output.write(128 | 126);
            output.write(size >>> 8);
            output.write(size);
        } else {
            output.write(128 | 127);
            for (int i = 7; i >= 0; i--) output.write((int)((long) size >>> (i * 8)));
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        output.write(mask);
        for (int i = 0; i < size; i++) frame.data[i] ^= mask[i & 3];
        output.write(frame.data);
        output.flush();
    }

    private static void validateClose(byte[] data) throws IOException {
        if (data.length == 0) return;
        if (data.length == 1) throw new ProtocolError(1002, "K 歌连接关闭帧无效");
        int code = ((data[0] & 255) << 8) | (data[1] & 255);
        if (!((code >= 1000 && code <= 1014 && code != 1004 && code != 1005 && code != 1006)
                || (code >= 3000 && code <= 4999))) throw new ProtocolError(1002, "K 歌连接关闭代码无效");
        utf8(data, 2);
    }

    private static byte[] closeCode(int code) { return new byte[] { (byte) (code >>> 8), (byte) code }; }

    private static String utf8(byte[] data, int offset) throws ProtocolError {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data, offset, data.length - offset)).toString();
        } catch (CharacterCodingException e) { throw new ProtocolError(1007, "K 歌消息不是有效文本"); }
    }

    private static int getByte(InputStream input) throws IOException {
        int b = input.read();
        if (b < 0) throw new EOFException("K 歌连接已中断");
        return b;
    }

    private static void readFully(InputStream input, byte[] output, int offset, int length) throws IOException {
        int end = offset + length;
        while (offset < end) {
            int received = input.read(output, offset, end - offset);
            if (received < 0) throw new EOFException("K 歌连接已中断");
            if (received == 0) output[offset++] = (byte) getByte(input);
            else offset += received;
        }
    }

    static final class Frame {
        final int opcode;
        final byte[] data;
        Frame(int opcode, byte[] data) { this.opcode = opcode; this.data = data; }
    }

    static final class ProtocolError extends IOException {
        final int code;
        ProtocolError(int code, String message) { super(message); this.code = code; }
    }
}
