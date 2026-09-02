package com.hciptv.manager;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// App precisa ocupar a tela inteira, inclusive por cima da barra de
// notificações/status e da barra de navegação (pedido do usuário) — modo
// imersivo "sticky": as barras do sistema ficam escondidas e só reaparecem
// temporariamente com um swipe da borda, sumindo de novo sozinhas depois.
// onWindowFocusChanged reaplica sempre que a activity volta a ter foco
// (ex.: depois de abrir outro app e voltar) — sem isso o Android restaura as
// barras sozinho nessas transições.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
