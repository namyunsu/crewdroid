plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.2.10"
}
android {
    namespace = "dev.crewdroid.daeri"
    compileSdk = 35
    defaultConfig { applicationId = "dev.crewdroid.daeri"; minSdk = 31; targetSdk = 34; versionCode = 1; versionName = "0.1" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { jvmToolchain(17) }
