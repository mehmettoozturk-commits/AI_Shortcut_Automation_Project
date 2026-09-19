// Phase 4D-1 — gerçek uçtan uca UI testi.
//
// Bu, `npm run serve`in GERÇEKTEN çalışıyor olmasını gerektirir
// (fake/mock DEĞİL) — Simulator, host Mac'in localhost'unu paylaştığı
// için AutomationApp gerçek backend'e (varsayılan olarak kural tabanlı
// sağlayıcı) bağlanır. Bu dosya CI'ın standart parçası değildir (Phase
// 4B/4C'nin "gerçek ağ çağrısını XCTest'e sokma" disiplinini bozmaz —
// bu, `swift test`'in çalıştırdığı otomatik paketten AYRI, elle
// tetiklenen bir UI test hedefi); yalnızca gerçek bir backend elle
// ayağa kaldırıldığında `xcodebuild test` ile çalıştırılır.
//
// ⚠️ EN ÖNEMLİ KONTROL: `testUnderstandingScreenNeverShowsCapabilityId`
// — ekrandaki TÜM statik metinlerin arasında hiçbir capability id
// (nokta içeren "ios."/"tesla." gibi bir dize) GEÇMEDİĞİNİ doğrular.
// Bu, projenin en temel değişmezinin artık UI katmanında da
// (yalnızca kaynak kod/pipeline'da değil) gerçek bir çalışan uygulamada
// kilitlendiğinin kanıtı.

import XCTest

final class AutomationAppUITests: XCTestCase {
    func makeApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PLAN_BACKEND_URL"] = "http://localhost:3000/plan"
        return app
    }

    func testSimplePlan_showsUnderstandingScreenWithHumanLanguageOnly() throws {
        let app = makeApp()
        app.launch()

        let field = app.textFields["promptField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Pil yüzde 20'ye düşünce bana haber ver")

        app.buttons["sendButton"].tap()

        let triggerSummary = app.staticTexts["triggerSummary"]
        XCTAssertTrue(triggerSummary.waitForExistence(timeout: 10), "Backend'den 'plan' yanıtı gelmeli")

        let actionSummary = app.staticTexts["actionSummary"]
        XCTAssertTrue(actionSummary.exists)

        assertNoCapabilityIdVisible(in: app)

        XCTAssertTrue(app.buttons["confirmButton"].exists)
        XCTAssertTrue(app.buttons["reviseButton"].exists)
    }

    // EN ÖNEMLİ TEST.
    func testUnderstandingScreenNeverShowsCapabilityId() throws {
        let app = makeApp()
        app.launch()

        let field = app.textFields["promptField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç")
        app.buttons["sendButton"].tap()

        XCTAssertTrue(app.staticTexts["triggerSummary"].waitForExistence(timeout: 10))
        assertNoCapabilityIdVisible(in: app)
    }

    // Phase 4E-2 — registry `description` (mekanizma odaklı, resmi dil)
    // ile `displayDescription` (doğal dil) AYRIMI: ekranda gerçekten
    // `displayDescription` metni var, eski `description` dili (örn.
    // "tetiklenir", "(gözcü modu)") SIZMIYOR.
    func testUnderstandingScreen_showsDisplayDescription_notTechnicalDescription() throws {
        let app = makeApp()
        app.launch()

        let field = app.textFields["promptField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç")
        app.buttons["sendButton"].tap()

        let triggerSummary = app.staticTexts["triggerSummary"]
        XCTAssertTrue(triggerSummary.waitForExistence(timeout: 10))
        XCTAssertEqual(triggerSummary.label, "Telefonunun Bluetooth bağlantısı kesildiğinde")

        let actionSummary = app.staticTexts["actionSummary"]
        XCTAssertTrue(actionSummary.exists)
        XCTAssertEqual(actionSummary.label, "Tesla'nın Sentry Mode özelliğini açar veya kapatır")

        for element in app.staticTexts.allElementsBoundByIndex {
            XCTAssertFalse(element.label.contains("tetiklenir"), "Teknik description dili sızdı: \(element.label)")
            XCTAssertFalse(element.label.contains("gözcü modu"), "Teknik description dili sızdı: \(element.label)")
        }
    }

    func testMultiTurnCorrection_onlyVehicleChanges() throws {
        let app = makeApp()
        app.launch()

        let field = app.textFields["promptField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Arabadan inince klimayı aç.")
        app.buttons["sendButton"].tap()

        let understanding = app.staticTexts["triggerSummary"]
        XCTAssertTrue(understanding.waitForExistence(timeout: 10))
        app.buttons["confirmButton"].tap()

        let question = app.staticTexts["missingInfoQuestion"]
        XCTAssertTrue(question.waitForExistence(timeout: 10))
        // Registry'den gelen seçeneklerden biri: "Tesla Model Y".
        let vehicleOption = app.buttons["Tesla Model Y"]
        XCTAssertTrue(vehicleOption.waitForExistence(timeout: 5))
        vehicleOption.tap()

        // Şimdi previewConfirm'e ulaşmalı (eksik izin notu içerebilir).
        XCTAssertTrue(app.buttons["createAutomationButton"].waitForExistence(timeout: 10))
    }

    /// Ekrandaki HİÇBİR statik metin bir capability id gibi görünmüyor
    /// (nokta içeren "ios."/"tesla." önekli bir dize).
    private func assertNoCapabilityIdVisible(in app: XCUIApplication) {
        for element in app.staticTexts.allElementsBoundByIndex {
            let label = element.label
            XCTAssertFalse(
                label.contains("ios.") || label.contains("tesla."),
                "Ekranda capability id gibi görünen bir metin bulundu: \(label)"
            )
        }
    }
}
