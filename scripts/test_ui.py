from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Capture console messages
        page.on("console", lambda msg: print(f"Console {msg.type}: {msg.text}"))
        
        # Capture uncaught exceptions
        page.on("pageerror", lambda err: print(f"Page Error: {err}"))

        # Navigate to the dashboard
        print("Navigating to http://localhost:8000/ripple/src/dashboard/index.html")
        page.goto("http://localhost:8000/ripple/src/dashboard/index.html", wait_until="networkidle")
        
        # Wait a bit just in case
        page.wait_for_timeout(2000)
        
        browser.close()

if __name__ == "__main__":
    run()
