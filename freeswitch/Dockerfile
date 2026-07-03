# drachtio 镜像预装 mod_audio_fork（drachtio 版），无需 apt install
# 镜像基于 Debian 9 + FreeSWITCH 1.10.1 + libwebsockets 15
# 配置路径：/usr/local/freeswitch/conf/
# 二进制：/usr/local/freeswitch/bin/freeswitch
# 模块路径：/usr/local/freeswitch/mod/
# 选择此镜像原因：signalwire/freeswitch:1.10.11-release 国内无法拉取（Docker Hub 限速+仓库可能私有），
#                 drachtio 镜像预装了 mod_audio_fork，可直接使用。
FROM drachtio/drachtio-freeswitch-mrf:v1.10.1-full

# 验证 mod_audio_fork 模块存在
RUN ls -la /usr/local/freeswitch/mod/mod_audio_fork.so
