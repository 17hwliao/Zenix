package com.zenix.musicplayer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class KaraokeWebSocketCheck {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void expectTooBig(byte[] input) throws IOException {
        try {
            new KaraokeWebSocket.MessageReader(new ByteArrayInputStream(input)).next();
            throw new AssertionError("expected frame limit");
        } catch (KaraokeWebSocket.ProtocolError expected) {
            require(expected.code == 1009, "size must be rejected before reading the absent payload");
        }
    }

    public static void main(String[] args) throws Exception {
        var frame = new ByteArrayOutputStream();
        frame.write(new byte[]{(byte) 0x81, 127, 0, 0, 0, 0, 0, 2, 64, 1});
        expectTooBig(frame.toByteArray());
        frame.reset();
        frame.write(new byte[]{1, 127, 0, 0, 0, 0, 0, 2, 64, 0});
        frame.write(new byte[KaraokeWebSocket.MAX_FRAME]);
        frame.write(new byte[]{(byte) 0x80, 1});
        expectTooBig(frame.toByteArray());

        try (var worker = new Worker()) {
            var done = new CountDownLatch(1);
            var feedback = new AtomicReference<IOException>();
            var first = new AtomicReference<String>();
            var client = new AtomicReference<KaraokeWebSocket>();
            var socket = new KaraokeWebSocket(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}), Integer.parseInt(args[0]),
                worker.pool, new KaraokeWebSocket.Listener() {
                    @Override public void opened() {
                        if (!client.get().send("Zenix 入场")) throw new IllegalStateException("client send rejected");
                    }
                    @Override public void text(String value) {
                        first.set(value);
                        client.get().close();
                    }
                    @Override public void ended(IOException error) {
                        feedback.set(error);
                        done.countDown();
                    }
                });
            client.set(socket);
            worker.pool.execute(socket);
            try {
                require(done.await(7, TimeUnit.SECONDS), "socket did not close");
                require(feedback.get() == null, "unexpected socket failure: " + feedback.get());
                require("蓝方已准备".equals(first.get()), "UTF-8 fragments were not reassembled");
            } finally {
                socket.cancel();
            }
        }
        System.out.println("KARAOKE_WEBSOCKET_PASS");
    }

    private static final class Worker implements AutoCloseable {
        final ExecutorService pool = Executors.newFixedThreadPool(2);
        @Override public void close() { pool.shutdownNow(); }
    }
}
