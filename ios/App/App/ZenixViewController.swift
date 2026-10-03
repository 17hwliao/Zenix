import Capacitor
import UIKit

final class ZenixViewController: CAPBridgeViewController {
    private var keyboardObserver: NSObjectProtocol?
    deinit { if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) } }
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ZenixNativePlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 16/255, green: 17/255, blue: 23/255, alpha: 1)
        webView?.scrollView.backgroundColor = webView?.backgroundColor
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.bounces = false
        keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] event in
            guard let self, let frame = event.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let local = view.convert(frame, from: nil)
            let overlap = view.bounds.intersection(local).height
            let height = max(1, view.bounds.height - (overlap.isFinite ? overlap : 0))
            // WKWebView owns keyboard resizing. Only publish the usable height.
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('zenix-keyboard',{detail:{open:\(overlap > 100),height:\(height)}}))", completionHandler: nil)
        }
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
