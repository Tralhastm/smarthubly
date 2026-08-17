package company.smarthubly.garcom;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {

    // Evita recarregamentos duplicados (onRestart + onWindowFocusChanged)
    private long lastReloadMs = 0;

    // ---- AUTOUPDATE ----
    // Verifica de hora em hora (e a cada volta do app) se existe um APK novo
    // em https://smarthubly.pages.dev/garcom-update.json. Se houver versão
    // maior que a instalada, baixa e instala sozinho — o garçom nunca precisa
    // reinstalar o app manualmente (padrão usado em apps de maquininha).
    private static final String UPDATE_MANIFEST_URL = "https://smarthubly.pages.dev/garcom-update.json";
    private static final String APK_FILE_NAME = "smarthubly-garcom-new.apk";
    private static final long UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000L; // 1h
    private long lastUpdateCheckMs = 0;

    @Override
    public void onResume() {
        super.onResume();
        maybeCheckForUpdate();
    }

    private int installedVersionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return (int) pi.getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }

    private void maybeCheckForUpdate() {
        long now = System.currentTimeMillis();
        if (now - lastUpdateCheckMs < UPDATE_CHECK_INTERVAL_MS) return;
        lastUpdateCheckMs = now;
        Thread t = new Thread(this::checkUpdate, "smarthubly-autoupdate");
        t.setDaemon(true);
        t.start();
    }

    private void checkUpdate() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(UPDATE_MANIFEST_URL).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return;
            String body = new String(c.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            JSONObject j = new JSONObject(body);
            int remoteVersion = j.optInt("version", 0);
            String apkUrl = j.optString("apk_url", "");
            if (remoteVersion <= 0 || apkUrl.isEmpty()) return;
            int local = installedVersionCode();
            if (remoteVersion <= local) return;
            Log.i("AutoUpdate", "Nova versão " + remoteVersion + " > " + local + " — baixando " + apkUrl);
            downloadAndInstall(apkUrl);
        } catch (Exception e) {
            Log.w("AutoUpdate", "check update falhou: " + e.getMessage());
        }
    }

    private void downloadAndInstall(String apkUrl) {
        try {
            File outDir = new File(getExternalFilesDir(null), "updates");
            if (!outDir.exists()) outDir.mkdirs();
            File apkFile = new File(outDir, APK_FILE_NAME);
            HttpURLConnection c = (HttpURLConnection) new URL(apkUrl).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(60000);
            java.io.InputStream is = c.getInputStream();
            java.io.FileOutputStream fos = new java.io.FileOutputStream(apkFile);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
            fos.flush();
            fos.close();
            is.close();
            Log.i("AutoUpdate", "APK baixado, instalando...");
            installApk(apkFile);
        } catch (Exception e) {
            Log.w("AutoUpdate", "download/install falhou: " + e.getMessage());
        }
    }

    private void installApk(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Log.w("AutoUpdate", "intent de instalação falhou: " + e.getMessage());
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Mantém o WebView vivo mesmo em background — evita o "tela preta/branca
        // ao sair e voltar" em aparelhos que suspendem renderização.
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception ignored) { }
    }

    @Override
    public void onRestart() {
        super.onRestart();
        schedulePageReload();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Força o WebView a redesenhar a superfície (resolve o frame
            // preto/branco preso) sem recarregar a página de novo.
            try {
                WebView wv = getBridge().getWebView();
                if (wv != null) {
                    wv.invalidate();
                }
            } catch (Exception ignored) { }
            // Se acabou de voltar de onStop, recarrega a página
            schedulePageReload();
        }
    }

    private void schedulePageReload() {
        try {
            long now = System.currentTimeMillis();
            if (now - lastReloadMs < 2000) {
                return; // já recarregou — não duplicar
            }
            lastReloadMs = now;
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    WebView wv = getBridge().getWebView();
                    if (wv != null) {
                        String currentUrl = wv.getUrl();
                        if (currentUrl != null && !currentUrl.isEmpty()) {
                            wv.loadUrl(currentUrl);
                        } else {
                            wv.reload();
                        }
                    }
                } catch (Exception ignored) { }
            }, 300);
        } catch (Exception ignored) { }
    }
}
