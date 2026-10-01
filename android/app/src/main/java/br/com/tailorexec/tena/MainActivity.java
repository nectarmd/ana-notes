package br.com.tailorexec.tena;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Precisam ser registrados ANTES do super.onCreate (a bridge e criada la).
        registerPlugin(SharedFilePlugin.class);
        registerPlugin(BgRecorderPlugin.class);
        registerPlugin(FileSavePlugin.class);
        super.onCreate(savedInstanceState);
        handleShare(getIntent());
    }

    /** App ja estava aberto: o Android reusa a task (launchMode=singleTask). */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (handleShare(intent)) {
            SharedFilePlugin.notifyAvailable();
        }
    }

    private boolean handleShare(Intent intent) {
        if (intent == null) return false;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return false;

        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return false;

        SharedFilePlugin.setPending(uri);
        return true;
    }
}
