package com.albion.market.siwc;
import java.util.Arrays;
public final class RefreshPolicy {
 public static boolean discardAfterFailure(boolean rotated,String code){return rotated||Arrays.asList("invalid_grant","invalid_refresh_token","token_expired","refresh_token_expired","refresh_token_invalidated","refresh_token_reused").contains(code);}
}
