/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    let settings = app.settings()

    settings.meta.appName = "3fce84f0-44bb-425c-b28b-1525e7fa4989.app-preview.com"
    settings.meta.appURL = "https://3fce84f0-44bb-425c-b28b-1525e7fa4989.app-preview.com/hcgi/platform"
    settings.meta.hideControls = true

    settings.logs.maxDays = 7
    settings.logs.minLevel = 8
    settings.logs.logIP = true
    
    settings.trustedProxy.headers = [
        "X-Real-IP",
        "X-Forwarded-For",
        "CF-Connecting-IP",
    ]

    app.save(settings)
})
