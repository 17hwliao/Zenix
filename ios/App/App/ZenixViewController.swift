import Capacitor
import UIKit

final class ZenixViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ZenixNativePlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 16/255, green: 17/255, blue: 23/255, alpha: 1)
        webView?.scrollView.backgroundColor = webView?.backgroundColor
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.bounces = false
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
