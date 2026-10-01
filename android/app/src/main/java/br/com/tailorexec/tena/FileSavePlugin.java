package br.com.tailorexec.tena;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Entrega arquivos gerados pelo site (PDF, Word, transcricao, audio, mapa mental) ao Android.
 *
 * A WebView do Capacitor ignora {@code <a download>} e nao tem navigator.share nem impressao,
 * entao esses botoes nao faziam nada no APK. A camada web (src/lib/saveFile.ts) manda o arquivo
 * em pedacos base64 (append) e depois pede o "Compartilhar" do sistema (open), de onde a pessoa
 * salva no Drive/Arquivos ou manda pelo WhatsApp/e-mail.
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    private File dir() {
        File d = new File(getContext().getCacheDir(), "exports");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /** Nome vindo da web: so o nome do arquivo, sem caminho nem caracteres reservados. */
    private static String safeName(String name) {
        if (name == null) return "arquivo";
        String n = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "-").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) return "arquivo";
        return n.length() > 120 ? n.substring(n.length() - 120) : n;
    }

    @PluginMethod
    public void append(PluginCall call) {
        String name = safeName(call.getString("name"));
        String data = call.getString("data", "");
        boolean reset = Boolean.TRUE.equals(call.getBoolean("reset", false));
        try {
            File f = new File(dir(), name);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(f, !reset)) {
                out.write(bytes);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("write_failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String name = safeName(call.getString("name"));
        String mime = call.getString("mimeType", "application/octet-stream");
        String title = call.getString("title", name);
        File f = new File(dir(), name);
        if (!f.exists()) {
            call.reject("not_found");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TITLE, title);
            send.setClipData(ClipData.newRawUri(title, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("open_failed: " + e.getMessage());
        }
    }
}
