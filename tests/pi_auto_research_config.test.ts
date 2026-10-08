import { test } from "node:test";
import assert from "node:assert/strict";
import { autoResearchEnabled, arcAutoResearchDefault } from "../demo/pi_auto_research_config.ts";

test("preserve adapter defaults and ARC opt-in; general override wins", () => {
	assert.equal(autoResearchEnabled(true, {}), true);
	assert.equal(autoResearchEnabled(false, {}), false);
	assert.equal(arcAutoResearchDefault({}), false);
	assert.equal(arcAutoResearchDefault({ PI_ARC_AUTO_RESEARCH: "enabled" }), true);
	assert.equal(autoResearchEnabled(true, { PI_AUTORESEARCH_ENABLED: "disabled" }), false);
	assert.equal(arcAutoResearchDefault({ PI_AUTORESEARCH_ENABLED: "disabled", PI_ARC_AUTO_RESEARCH: "enabled" }), false);
	assert.equal(arcAutoResearchDefault({ PI_AUTORESEARCH_ENABLED: "enabled", PI_ARC_AUTO_RESEARCH: "disabled" }), true);
});

test("fail on invalid winning values, including an empty string", () => {
	for (const value of ["", "true", "0", "enabld"]) {
		assert.throws(() => autoResearchEnabled(true, { PI_AUTORESEARCH_ENABLED: value }), /PI_AUTORESEARCH_ENABLED/);
		assert.throws(() => arcAutoResearchDefault({ PI_ARC_AUTO_RESEARCH: value }), /PI_ARC_AUTO_RESEARCH/);
	}
	assert.equal(arcAutoResearchDefault({ PI_AUTORESEARCH_ENABLED: "disabled", PI_ARC_AUTO_RESEARCH: "typo" }), false);
});
