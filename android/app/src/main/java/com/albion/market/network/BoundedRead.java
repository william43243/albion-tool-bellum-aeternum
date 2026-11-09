package com.albion.market.network;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Limits decoded response bytes, including when the server uses compression. */
public final class BoundedRead {
    private BoundedRead() {}
    public static byte[] read(InputStream input, int limit) throws IOException {
        if (limit < 0) throw new IllegalArgumentException("invalid limit");
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 8192));
        byte[] buffer = new byte[8192];
        for (int count; (count = input.read(buffer)) != -1;) {
            if (count > limit - output.size()) throw new IOException("MARKET_RESPONSE_TOO_LARGE");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
