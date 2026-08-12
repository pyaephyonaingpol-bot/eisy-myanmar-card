plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.eisyglobal.depositlistener"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.eisyglobal.depositlistener"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // Change to your backend server IP (use 10.0.2.2 for Android emulator → host machine)
        buildConfigField("String", "SERVER_URL", "\"http://10.0.2.2:3000\"")
        // Must match server DEPOSIT_LISTENER_SECRET (leave empty only for local unsigned builds)
        buildConfigField("String", "LISTENER_SECRET", "\"${project.findProperty("DEPOSIT_LISTENER_SECRET") ?: ""}\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
