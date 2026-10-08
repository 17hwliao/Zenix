package com.zenix.musicplayer;

/** Serializes one kind of source work. Cancellation never touches another lane. */
final class SourceEngineLane<T extends AutoCloseable> {
    interface Factory<T> { T open() throws Exception; }
    interface Work<T, R> { R run(T engine) throws Exception; }
    private final Object serial = new Object(), state = new Object();
    private T engine;
    private String sourceId = "";
    private long epoch;
    private int busy;

    <R> R call(String id, Factory<T> factory, Work<T, R> work) throws Exception {
        synchronized (serial) {
            long ticket;
            T current, retired = null;
            synchronized (state) {
                busy++;
                ticket = epoch;
                if (!id.equals(sourceId)) { retired = engine; engine = null; }
                sourceId = id;
                current = engine;
            }
            dispose(retired);
            try {
                if (current == null) {
                    current = factory.open();
                    synchronized (state) {
                        if (ticket != epoch) { dispose(current); throw new java.util.concurrent.CancellationException(); }
                        engine = current;
                    }
                }
                R result = work.run(current);
                synchronized (state) { if (ticket != epoch) throw new java.util.concurrent.CancellationException(); }
                return result;
            } catch (Exception error) {
                synchronized (state) { if (engine == current) engine = null; }
                dispose(current);
                throw error;
            } finally { synchronized (state) { busy--; } }
        }
    }
    void cancel() { cancel(null); }
    void cancel(String id) {
        T retired;
        synchronized (state) {
            if (id != null && !id.equals(sourceId)) return;
            epoch++;
            retired = engine;
            engine = null;
        }
        dispose(retired);
    }
    boolean trimIdle() {
        T retired;
        synchronized (state) { if (busy != 0) return false; retired = engine; engine = null; }
        dispose(retired);
        return true;
    }
    private void dispose(T value) { if (value != null) try { value.close(); } catch (Exception ignored) {} }
}
