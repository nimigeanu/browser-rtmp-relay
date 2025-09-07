apt update && apt upgrade -y
apt install -y git curl unzip cron docker.io nodejs npm nginx certbot python3-certbot-nginx
npm install -g pm2

certbot --nginx \
  -d rtmprelay4.wpstream.live \
  --non-interactive \
  --agree-tos \
  -m admin@rtmprelay4.wpstream.live \
  --redirect

rsync -aHAX /tmp/rtmprelay/assets/ /
rm -rf -- /tmp/rtmprelay

chmod +x /usr/share/ovenmediaengine/launcher/ome_docker_launcher.sh
/usr/share/ovenmediaengine/launcher/ome_docker_launcher.sh setup

SSL_DIR="/etc/letsencrypt/live/rtmprelay4.wpstream.live"
OME_CONF_DIR="/usr/share/ovenmediaengine/conf"

cp $SSL_DIR/cert.pem $OME_CONF_DIR/cert.crt
cp $SSL_DIR/privkey.pem $OME_CONF_DIR/cert.key
cp $SSL_DIR/fullchain.pem $OME_CONF_DIR/cert.ca-bundle

chmod 600 $OME_CONF_DIR/cert.crt $OME_CONF_DIR/cert.key $OME_CONF_DIR/cert.ca-bundle

export PM2_HOME=/root/.pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

cd /usr/share/ovenmediaengine/admission/
npm install
pm2 start

pm2 startup systemd
pm2 save

/usr/share/ovenmediaengine/launcher/ome_docker_launcher.sh start