package com.kvideo.tv

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.Rational
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {

    companion object {
        private const val PREFS_NAME = "kvideo_tv_settings"
        private const val PREF_SERVER_URL = "server_url"
        private const val TAG = "KVideoMainActivity"

        // The site supports Chrome 66+ (ES2019 syntax); older WebViews (e.g. Android 6 stock Chrome 44) render a blank page
        private const val MIN_WEBVIEW_MAJOR = 66

        // Media keys are forwarded to the page as the player's keyboard shortcuts
        private val MEDIA_KEY_SHORTCUTS = mapOf(
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "k",
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "l",
            KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD to "l",
            KeyEvent.KEYCODE_MEDIA_STEP_FORWARD to "l",
            KeyEvent.KEYCODE_MEDIA_REWIND to "j",
            KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD to "j",
            KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD to "j",
            KeyEvent.KEYCODE_CHANNEL_UP to "ChannelUp",
            KeyEvent.KEYCODE_CHANNEL_DOWN to "ChannelDown"
        )

        // Center of the focused text field in WebView pixels, or null when no text field is focused
        private const val FOCUSED_TEXT_FIELD_JS = """
            (function () {
                var el = document.activeElement;
                if (!el) return null;
                var isTextField = el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' &&
                    !/^(button|submit|reset|checkbox|radio|range|file|color|image)$/i.test(el.type));
                if (!isTextField) return null;
                var rect = el.getBoundingClientRect();
                var ratio = window.devicePixelRatio || 1;
                return [(rect.left + rect.width / 2) * ratio, (rect.top + rect.height / 2) * ratio];
            })()
        """

        // The page calls preventDefault() when it consumed Back (closed a menu, dialog or fullscreen)
        private const val PAGE_BACK_JS = """
            (function () {
                var event = new CustomEvent('kvideo-android-back', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            })()
        """
    }

    private lateinit var webView: WebView
    private lateinit var setupContainer: View
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var urlInput: EditText
    private lateinit var statusText: TextView
    private lateinit var openButton: Button
    private lateinit var saveButton: Button
    private lateinit var prefs: android.content.SharedPreferences
    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null
    private var wasSetupVisibleBeforeFullscreen = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersiveMode()

        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        setupContainer = findViewById(R.id.setup_container)
        fullscreenContainer = findViewById(R.id.fullscreen_container)
        urlInput = findViewById(R.id.url_input)
        statusText = findViewById(R.id.status_text)
        openButton = findViewById(R.id.open_button)
        saveButton = findViewById(R.id.save_button)

        saveButton.setOnClickListener {
            openConfiguredUrl()
        }
        urlInput.setOnEditorActionListener { _, actionId, event ->
            val isKeyboardConfirmAction = actionId == EditorInfo.IME_NULL ||
                actionId == EditorInfo.IME_ACTION_DONE ||
                actionId == EditorInfo.IME_ACTION_GO ||
                actionId == EditorInfo.IME_ACTION_SEND ||
                actionId == EditorInfo.IME_ACTION_NEXT
            val isEnterKey = event?.action == KeyEvent.ACTION_DOWN && (
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                    event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                )

            if (isKeyboardConfirmAction || isEnterKey) {
                openConfiguredUrl()
                true
            } else {
                false
            }
        }

        webView.apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                loadWithOverviewMode = true
                useWideViewPort = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                databaseEnabled = true
                // Lets the page detect the TV shell and switch to D-pad navigation
                userAgentString = "$userAgentString Android TV KVideoTV/${BuildConfig.VERSION_NAME}"
            }

            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null || callback == null) {
                        callback?.onCustomViewHidden()
                        return
                    }

                    if (customView != null) {
                        callback.onCustomViewHidden()
                        return
                    }

                    wasSetupVisibleBeforeFullscreen = isSetupVisible()
                    customView = view
                    customViewCallback = callback

                    fullscreenContainer.removeAllViews()
                    fullscreenContainer.addView(
                        view,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    fullscreenContainer.visibility = View.VISIBLE
                    webView.visibility = View.GONE
                    setupContainer.visibility = View.GONE
                    applyImmersiveMode()
                }

                override fun onHideCustomView() {
                    exitCustomFullscreen()
                }
            }
            addJavascriptInterface(AndroidPlayerBridge(), "KVideoAndroid")
        }

        val webViewMajor = getWebViewMajorVersion()
        val configuredUrl = getConfiguredUrl()
        if (webViewMajor in 1 until MIN_WEBVIEW_MAJOR) {
            urlInput.setText(configuredUrl)
            showSetup(getString(R.string.status_webview_unsupported, webViewMajor, MIN_WEBVIEW_MAJOR))
        } else if (configuredUrl.isNotEmpty()) {
            urlInput.setText(configuredUrl)
            loadConfiguredUrl(configuredUrl)
        } else {
            showSetup(getString(R.string.status_first_launch))
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (!isSetupVisible() && keyCode == KeyEvent.KEYCODE_BACK && customView != null) {
            exitCustomFullscreen()
            return true
        }

        if (!isSetupVisible() && (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS)) {
            showSetup(getString(R.string.status_settings_hint))
            return true
        }

        return super.onKeyDown(keyCode, event)
    }

    // Intercepts remote keys before the WebView sees them.
    // RestrictedApi is a false positive: androidx.core's ComponentActivity re-declares the public Activity method
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (isSetupVisible()) {
            return super.dispatchKeyEvent(event)
        }

        val shortcut = MEDIA_KEY_SHORTCUTS[event.keyCode]
        if (shortcut != null) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                dispatchPageKey(shortcut)
            }
            return true
        }

        if (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY || event.keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                setPagePlayback(event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY)
            }
            return true
        }

        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                handleCenterPress()
            }
            return true
        }

        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Use OnBackPressedDispatcher")
    override fun onBackPressed() {
        if (customView != null) {
            exitCustomFullscreen()
            return
        }

        if (isSetupVisible()) {
            @Suppress("DEPRECATION")
            super.onBackPressed()
            return
        }

        // Let the page close its own layers first; fall back to history navigation
        webView.evaluateJavascript(PAGE_BACK_JS) { handled ->
            if (handled == "true") {
                return@evaluateJavascript
            }

            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                showSetup(getString(R.string.status_settings_hint))
            }
        }
    }

    /** D-pad center opens the keyboard on text fields, otherwise acts as Enter for spatial navigation. */
    private fun handleCenterPress() {
        webView.evaluateJavascript(FOCUSED_TEXT_FIELD_JS) { result ->
            val point = parseTextFieldCenter(result)
            if (point != null) {
                // WebView only raises the keyboard for user gestures, so tap the field
                tapWebView(point.first, point.second)
            } else {
                webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
                webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
            }
        }
    }

    private fun parseTextFieldCenter(result: String?): Pair<Float, Float>? {
        if (result == null || result == "null") {
            return null
        }

        return try {
            val coordinates = JSONArray(result)
            Pair(coordinates.getDouble(0).toFloat(), coordinates.getDouble(1).toFloat())
        } catch (error: JSONException) {
            Log.w(TAG, "Unexpected text field position: $result", error)
            null
        }
    }

    private fun tapWebView(x: Float, y: Float) {
        val downTime = SystemClock.uptimeMillis()
        listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP).forEach { action ->
            val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            webView.dispatchTouchEvent(event)
            event.recycle()
        }
    }

    /** Sends a synthetic key to the page, away from text fields so it isn't typed. */
    private fun dispatchPageKey(key: String) {
        val js = """
            (function (key) {
                var target = document.activeElement;
                if (!target || target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName)) {
                    target = document.body;
                }
                var init = { key: key, bubbles: true, cancelable: true };
                target.dispatchEvent(new KeyboardEvent('keydown', init));
                target.dispatchEvent(new KeyboardEvent('keyup', init));
            })(${JSONObject.quote(key)});
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun setPagePlayback(play: Boolean) {
        val js = """
            (function (play) {
                var video = document.querySelector('video');
                if (!video) return;
                if (play && video.paused) video.play().catch(function () {});
                if (!play && !video.paused) video.pause();
            })($play);
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveMode()
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        dispatchPictureInPictureChange(isInPictureInPictureMode)
        if (!isInPictureInPictureMode) {
            applyImmersiveMode()
        }
    }

    override fun onDestroy() {
        exitCustomFullscreen()
        webView.destroy()
        super.onDestroy()
    }

    private fun openConfiguredUrl() {
        val normalizedUrl = normalizeUrl(urlInput.text.toString())
        if (!isValidUrl(normalizedUrl)) {
            statusText.text = getString(R.string.status_invalid_url)
            urlInput.requestFocus()
            return
        }

        prefs.edit().putString(PREF_SERVER_URL, normalizedUrl).apply()
        loadConfiguredUrl(normalizedUrl)
    }

    private fun loadConfiguredUrl(url: String) {
        setupContainer.visibility = View.GONE
        statusText.text = getString(R.string.status_ready)
        webView.loadUrl(url)
    }

    private fun showSetup(message: String) {
        val currentUrl = getConfiguredUrl()
        if (currentUrl.isNotEmpty() && urlInput.text.toString().isBlank()) {
            urlInput.setText(currentUrl)
        }

        if (currentUrl.isNotEmpty()) {
            openButton.text = getString(R.string.button_open_saved)
            openButton.setOnClickListener {
                urlInput.setText(currentUrl)
                loadConfiguredUrl(currentUrl)
            }
        } else {
            openButton.text = getString(R.string.button_exit)
            openButton.setOnClickListener {
                finish()
            }
        }

        statusText.text = message
        setupContainer.visibility = View.VISIBLE
        urlInput.requestFocus()
    }

    private fun getConfiguredUrl(): String {
        val savedUrl = prefs.getString(PREF_SERVER_URL, null)?.trim().orEmpty()
        if (isValidUrl(savedUrl)) {
            return savedUrl
        }

        val defaultUrl = normalizeUrl(BuildConfig.DEFAULT_KVIDEO_URL)
        return if (isValidUrl(defaultUrl)) defaultUrl else ""
    }

    /** Chromium major version of the system WebView, or 0 when it can't be determined. */
    private fun getWebViewMajorVersion(): Int {
        return try {
            val userAgent = WebSettings.getDefaultUserAgent(this)
            Regex("""Chrome/(\d+)""").find(userAgent)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        } catch (error: RuntimeException) {
            Log.w(TAG, "Failed to read WebView version", error)
            0
        }
    }

    private fun isSetupVisible(): Boolean = setupContainer.visibility == View.VISIBLE

    private fun normalizeUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) {
            return ""
        }

        val withScheme = if (
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            trimmed
        } else {
            "https://$trimmed"
        }

        return withScheme.removeSuffix("/")
    }

    private fun isValidUrl(url: String): Boolean {
        if (url.isBlank()) {
            return false
        }

        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase()
        return (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
    }

    private fun applyImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
    }

    private fun exitCustomFullscreen() {
        val currentCustomView = customView ?: return
        fullscreenContainer.removeView(currentCustomView)
        fullscreenContainer.visibility = View.GONE
        customView = null
        webView.visibility = View.VISIBLE
        if (wasSetupVisibleBeforeFullscreen) {
            setupContainer.visibility = View.VISIBLE
        }
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        wasSetupVisibleBeforeFullscreen = false
        applyImmersiveMode()
    }

    private fun isPictureInPictureSupported(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false
        }

        return packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    private fun dispatchPictureInPictureChange(isInPictureInPictureMode: Boolean) {
        val js = """
            window.dispatchEvent(new CustomEvent('kvideo-android-pip-change', {
                detail: { inPictureInPicture: ${if (isInPictureInPictureMode) "true" else "false"} }
            }));
        """.trimIndent()

        webView.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (error: Throwable) {
                Log.w(TAG, "Failed to dispatch Picture-in-Picture change event", error)
            }
        }
    }

    private fun createSourceRectHint(left: Int, top: Int, right: Int, bottom: Int): Rect? {
        if (right <= left || bottom <= top) {
            return null
        }

        val density = resources.displayMetrics.density
        return Rect(
            (left * density).roundToInt(),
            (top * density).roundToInt(),
            (right * density).roundToInt(),
            (bottom * density).roundToInt()
        )
    }

    private inner class AndroidPlayerBridge {
        @JavascriptInterface
        fun isPictureInPictureSupported(): Boolean = this@MainActivity.isPictureInPictureSupported()

        @JavascriptInterface
        fun enterPictureInPicture(
            width: Int,
            height: Int,
            left: Int,
            top: Int,
            right: Int,
            bottom: Int
        ): Boolean {
            // Explicit SDK check so lint sees PictureInPictureParams (API 26) is guarded on Android 6/7
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !this@MainActivity.isPictureInPictureSupported()) {
                return false
            }

            val didEnterPiP = AtomicBoolean(false)
            val latch = CountDownLatch(1)

            runOnUiThread {
                try {
                    val builder = android.app.PictureInPictureParams.Builder()
                    if (width > 0 && height > 0) {
                        builder.setAspectRatio(Rational(width, height))
                    }
                    createSourceRectHint(left, top, right, bottom)?.let(builder::setSourceRectHint)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        builder.setSeamlessResizeEnabled(true)
                    }
                    didEnterPiP.set(enterPictureInPictureMode(builder.build()))
                } catch (error: IllegalStateException) {
                    Log.w(TAG, "Failed to enter Picture-in-Picture mode", error)
                } finally {
                    latch.countDown()
                }
            }

            return try {
                latch.await(1500, TimeUnit.MILLISECONDS)
                didEnterPiP.get()
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                Log.w(TAG, "Interrupted while waiting for Picture-in-Picture result", error)
                false
            }
        }
    }
}
