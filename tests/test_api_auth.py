from flask import url_for
from bson import ObjectId


def test_public_user_api(app, client):
    company_ids = app.data.insert('companies', [{
        'phone': '2132132134',
        'sd_subscriber_id': '12345',
        'name': 'Press Co.',
        'is_enabled': True,
        'contact_name': 'Tom'
    }])
    user = {
        '_id': ObjectId("5c5914275f627d5885fee6a8"),
        'first_name': 'Normal',
        'last_name': 'User',
        'email': 'normal@sourcefabric.org',
        'password': '$2b$12$HGyWCf9VNfnVAwc2wQxQW.Op3Ejk7KIGE6urUXugpI0KQuuK6RWIG',
        'user_type': 'public',
        'is_validated': True,
        'is_enabled': True,
        'is_approved': True,
        'receive_email': True,
        'phone': '2132132134',
        'expiry_alert': True,
        'company': company_ids[0]}
    app.data.insert('users', [user])
    client.post(
        url_for('auth.login'),
        data={'email': 'normal@sourcefabric.org', 'password': 'admin'},
        follow_redirects=True
    )

    resp = client.get("/api")
    assert 200 == resp.status_code

    resp = client.get("/api/users")
    assert resp.status_code == 401
