<?php
/**
 * Plugin Name: Autopilot SEO Meta
 * Description: Lets the blog autopilot set the Yoast / Rank Math meta description and focus keyword through the REST API.
 * Install: copy this file to wp-content/mu-plugins/ (create the folder if needed). No activation step.
 */

add_action( 'init', function () {
	$keys = array( '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw', 'rank_math_description', 'rank_math_focus_keyword' );
	foreach ( $keys as $key ) {
		register_post_meta( 'post', $key, array(
			'type'          => 'string',
			'single'        => true,
			'show_in_rest'  => true,
			'auth_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
		) );
	}
} );
