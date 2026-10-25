# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.opencustom.telegram.* {
  native <methods>;
}

-keep class com.opencustom.telegram.WryActivity {
  public <init>(...);

  void setWebView(com.opencustom.telegram.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.opencustom.telegram.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.opencustom.telegram.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.opencustom.telegram.RustWebChromeClient,com.opencustom.telegram.RustWebViewClient {
  public <init>(...);
}
