plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.2.10"
}
android {
    namespace = "dev.crewdroid.agent"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.crewdroid.agent"
        minSdk = 31
        targetSdk = 34
        versionCode = 1 // keep equal to HELPER_VERSION in src/helper.ts (test/helper.test.ts checks)
        versionName = "0.1"
    }
    buildTypes {
        // R8 strips the unused Kotlin stdlib: a small APK installs in well under a second on every `up`.
        release {
            isMinifyEnabled = true
            proguardFiles("proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
