ALTER TABLE "global_configs"
ADD COLUMN "outbound_rules" JSONB NOT NULL DEFAULT '{
  "callWindow": {
    "startTime": "09:00",
    "endTime": "18:00",
    "weekdaysOnly": true,
    "nonHolidayOnly": false
  },
  "dailyCallLimitPerCallee": 3,
  "blockedNumbers": [],
  "globalWhitelist": []
}'::jsonb;
