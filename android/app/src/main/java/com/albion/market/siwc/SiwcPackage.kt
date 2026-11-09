package com.albion.market.siwc
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
class SiwcPackage:ReactPackage {
 override fun createNativeModules(context:ReactApplicationContext):List<NativeModule> = listOf(SiwcModule(context))
 override fun createViewManagers(context:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()
}
