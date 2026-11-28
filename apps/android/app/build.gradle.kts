import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

// Release signing: key.properties next to settings.gradle.kts (never committed) with storeFile,
// storePassword, keyAlias and keyPassword. In CI the same four values come from the environment.
// See ../README.md, "Releasing".
val keyProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun signingValue(name: String, env: String): String? = keyProperties.getProperty(name) ?: providers.environmentVariable(env).orNull

val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }

android {
    // The package the app has always had on Google Play (the React Native versions 1.x).
    namespace = "com.bluelytics.mobileapp"
    // Android 17 QPR2 (37.2): Compose 1.13 requires compiling against 37.1 or later.
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "com.bluelytics.mobileapp"
        // Android 8.0: the variable fonts take their weight from the `wght` axis, which needs API 26.
        minSdk = 26
        targetSdk = 36
        // The React Native builds were uploaded per ABI with codes of the form abi × 1,048,576 + 8
        // (up to 4,194,312), and Google Play only accepts a higher code than any it has seen for the
        // package: the native app starts at 5,000,000. Raise both for every upload.
        versionCode = 5000000
        versionName = "2.0.0"
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile)
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without a keystore the release build is signed with the debug key, so it still builds
            // and installs for testing; Google Play rejects such a bundle.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests {
            // Robolectric (screen and interface tests) needs the merged resources and assets.
            isIncludeAndroidResources = true
            all { test ->
                test.maxHeapSize = "2g"
                // `LIVE=1` and `SCREENSHOTS=1` switch on the optional suites (README.md).
                test.environment("LIVE", System.getenv("LIVE") ?: "")
                test.environment("SCREENSHOTS", System.getenv("SCREENSHOTS") ?: "")
                test.environment("SCREENSHOT_SIZE", System.getenv("SCREENSHOT_SIZE") ?: "")
                test.systemProperty("robolectric.graphicsMode", "NATIVE")
                // Roborazzi writes images only when recording.
                if (System.getenv("SCREENSHOTS") == "1") test.systemProperty("roborazzi.test.record", "true")
                test.testLogging { events("failed", "skipped"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
            }
        }
    }

    lint {
        warningsAsErrors = false
        abortOnError = true
        checkDependencies = false
        // Versions are raised by hand, not by lint (which has no network in CI anyway); targetSdk stays
        // on 36 until the app has been tried against Android 17's behaviour changes.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.androidx.core)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    constraints {
        // Firebase depends on Fragment 1.0, which mishandles results of the permission request
        // MainActivity makes (lint: InvalidFragmentVersionForActivityResult).
        implementation(libs.androidx.fragment)
    }

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    debugImplementation(platform(libs.compose.bom))
    debugImplementation(libs.compose.ui.test.manifest)
}
