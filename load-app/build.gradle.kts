plugins {
    id("com.android.application") version "8.9.1"
}
android {
    namespace = "dev.crewdroid.load"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.crewdroid.load"
        minSdk = 31
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes {
        release {
            isMinifyEnabled = false // plain Java, no libraries: nothing to strip
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
