import java.util.Properties

plugins { id("com.android.application") }

// Values shared with the web app; packages/config/src/brand.ts is the source of truth for the id.
val siteHost = "qroove.sataklela.com"
val appVersion = rootProject.file("../web/package.json").readText()
    .let { Regex("\"version\":\\s*\"([^\"]+)\"").find(it)!!.groupValues[1] }

// Release signing: apps/android/keystore.properties (gitignored) or QROOVE_KEYSTORE_* env vars.
val ks = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun secret(key: String, env: String): String? = ks.getProperty(key) ?: System.getenv(env)

android {
    namespace = "com.sataklela.qroove"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.sataklela.qroove"
        minSdk = 23
        targetSdk = 36
        versionName = appVersion
        versionCode = (System.getenv("QROOVE_VERSION_CODE") ?: appVersion.split(".")
            .let { (a, b, c) -> (a.toInt() * 10000 + b.toInt() * 100 + c.toInt()).toString() }).toInt()
        manifestPlaceholders["host"] = siteHost
        manifestPlaceholders["launchUrl"] = "https://$siteHost/"
    }
    signingConfigs {
        create("release") {
            val file = secret("storeFile", "QROOVE_KEYSTORE_FILE")
            if (file != null) {
                storeFile = rootProject.file(file)
                storePassword = secret("storePassword", "QROOVE_KEYSTORE_PASSWORD")
                keyAlias = secret("keyAlias", "QROOVE_KEY_ALIAS")
                keyPassword = secret("keyPassword", "QROOVE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            val cfg = signingConfigs.getByName("release")
            if (cfg.storeFile != null) signingConfig = cfg
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.2")
}
