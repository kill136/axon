FROM php:7.4-apache

# Install PHP extensions required by Epay
RUN apt-get update && apt-get install -y \
    libzip-dev \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libcurl4-openssl-dev \
    unzip \
    git \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    pdo_mysql \
    mysqli \
    gd \
    curl \
    zip \
    bcmath \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Enable mod_rewrite (MPM fix done at runtime in start.sh)
RUN a2enmod rewrite

# Set working directory
WORKDIR /var/www/html

# Clone Epay source code
RUN git clone --depth 1 https://github.com/maajiko/Epay.git /tmp/epay \
    && cp -r /tmp/epay/* /tmp/epay/.* /var/www/html/ 2>/dev/null || true \
    && rm -rf /tmp/epay

# Set permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

# Apache config for .htaccess support  
RUN printf '<Directory /var/www/html>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-available/epay.conf \
    && a2enconf epay

# Copy startup script
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

CMD ["/usr/local/bin/start.sh"]
